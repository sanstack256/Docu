import PDFDocument from "pdfkit";
import { ExtractedPage, ContentBlock } from "./extractor";

export interface PDFGenerationOptions {
  siteTitle: string;
  sourceUrl: string;
  pages: ExtractedPage[];
  documentTitle?: string;
  failedPages?: Array<{ url: string; error: string }>;
  warnings?: string[];
}

export interface PDFGenerationResult {
  buffer: Buffer;
  pageCount: number;
}

interface TocEntry {
  title: string;
  level: 1 | 2;
  destId: string;
  pageNumber: number;
  chapterIndex?: number;
}

/**
 * Reads pixel dimensions (width, height) from a PNG or JPEG buffer for exact proportional scaling.
 */
export function getImageDimensions(buf: Buffer): { width: number; height: number } | null {
  try {
    // PNG: 89 50 4E 47 0D 0A 1A 0A + IHDR length(4) + 'IHDR'(4) + width(4) + height(4)
    if (
      buf.length >= 24 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    ) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height };
    }

    // JPEG: FF D8 ... scan for SOF0/SOF1/SOF2 markers (FF C0, FF C1, FF C2)
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < buf.length) {
        if (buf[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = buf[offset + 1];
        if (marker === 0xff) {
          offset++;
          continue;
        }
        // SOF markers
        if (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        ) {
          const height = buf.readUInt16BE(offset + 5);
          const width = buf.readUInt16BE(offset + 7);
          if (width > 0 && height > 0) return { width, height };
          break;
        }
        const segmentLength = buf.readUInt16BE(offset + 2);
        if (segmentLength < 2) break;
        offset += 2 + segmentLength;
      }
    }
  } catch {
    // Fallback if header is unreadable
  }
  return null;
}

/**
 * Computes proportional column widths for a table so narrow columns do not waste space
 * and wide columns wrap cleanly within the page width.
 */
function computeColumnWidths(allRows: string[][], colCount: number, pageWidth: number): number[] {
  if (colCount <= 1) return [pageWidth];

  const maxCharsPerCol = new Array<number>(colCount).fill(4);
  for (const row of allRows) {
    for (let c = 0; c < colCount; c++) {
      const len = (row[c] || "").length;
      if (len > maxCharsPerCol[c]) {
        maxCharsPerCol[c] = len;
      }
    }
  }

  // Use damped square-root weighting so one long paragraph column doesn't crush other columns
  const weights = maxCharsPerCol.map((chars) => Math.max(Math.sqrt(Math.min(chars, 160)), 2.5));
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);

  const minColWidth = Math.min(48, pageWidth / colCount);
  const rawWidths = weights.map((w) => Math.max((w / totalWeight) * pageWidth, minColWidth));
  const rawSum = rawWidths.reduce((acc, w) => acc + w, 0);

  return rawWidths.map((w) => (w / rawSum) * pageWidth);
}

/**
 * Generates a structured, clean, searchable PDF document from extracted documentation pages.
 */
export async function generateDocumentationPDF(
  options: PDFGenerationOptions
): Promise<PDFGenerationResult> {
  const { siteTitle, sourceUrl, pages, documentTitle, failedPages = [] } = options;
  const isPartial = failedPages.length > 0;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 54, bottom: 54, left: 54, right: 54 },
        bufferPages: true,
        info: {
          Title: documentTitle || `${siteTitle} — Documentation Manual`,
          Author: "Docu (https://github.com/sanstack256/Docu)",
          Subject: `${isPartial ? "[Partial] " : ""}Offline Documentation for ${siteTitle}`,
          Keywords: "documentation, manual, offline, pdf",
          CreationDate: new Date(),
        },
      });

      let recordedPageCount = 0;

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          buffer,
          pageCount: recordedPageCount,
        });
      });
      doc.on("error", (err: Error) => reject(err));

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const maxContentY = doc.page.height - doc.page.margins.bottom - 20;

      // ==========================================
      // 1. COVER / TITLE PAGE
      // ==========================================
      doc.moveDown(3.5);

      // Status Pill (Complete vs Partial Export)
      if (isPartial) {
        doc.roundedRect(doc.x, doc.y, 175, 22, 4).fill("#fffaf0");
        doc.roundedRect(doc.x, doc.y, 175, 22, 4).strokeColor("#dd6b20").lineWidth(0.75).stroke();
        doc.fillColor("#c05621").fontSize(8.5).font("Helvetica-Bold").text(
          "PARTIAL EXPORT — INCOMPLETE",
          doc.x + 10,
          doc.y + 6.5
        );
      } else {
        doc.roundedRect(doc.x, doc.y, 95, 20, 4).fill("#ebf8ff");
        doc.fillColor("#2b6cb0").fontSize(8.5).font("Helvetica-Bold").text(
          "OFFLINE MANUAL",
          doc.x + 8,
          doc.y + 6
        );
      }
      doc.moveDown(2);

      // Main Title
      const displayTitle = documentTitle || siteTitle;
      doc.fillColor("#1a202c").fontSize(26).font("Helvetica-Bold").text(displayTitle, {
        width: pageWidth,
      });
      doc.moveDown(0.4);

      // Subtitle
      doc.fillColor("#718096").fontSize(12.5).font("Helvetica").text(
        isPartial
          ? "Compiled Documentation Reference (Partial Export)"
          : "Compiled Documentation Reference",
        { width: pageWidth }
      );
      doc.moveDown(1.8);

      // Divider line
      doc.strokeColor("#e2e8f0").lineWidth(1).moveTo(doc.x, doc.y).lineTo(doc.x + pageWidth, doc.y).stroke();
      doc.moveDown(1.5);

      // Metadata block
      doc.fillColor("#4a5568").fontSize(9.5).font("Helvetica-Bold").text("Source URL:");
      doc.fillColor("#3182ce").fontSize(9.5).font("Helvetica").text(sourceUrl, {
        link: sourceUrl,
        underline: true,
        width: pageWidth,
      });
      doc.moveDown(0.6);

      doc.fillColor("#4a5568").fontSize(9.5).font("Helvetica-Bold").text("Compiled:");
      doc.fillColor("#718096").fontSize(9.5).font("Helvetica").text(new Date().toUTCString());
      doc.moveDown(0.6);

      const totalRequested = pages.length + failedPages.length;
      doc.fillColor("#4a5568").fontSize(9.5).font("Helvetica-Bold").text("Completeness Summary:");
      doc.fillColor("#2d3748").fontSize(9.5).font("Helvetica").text(
        `${pages.length} of ${totalRequested} selected documentation sections processed${
          isPartial ? ` (${failedPages.length} failed)` : ""
        }.`
      );

      // If partial, list omitted pages right on the cover page for transparency
      if (isPartial) {
        doc.moveDown(1);
        doc.fillColor("#c05621").fontSize(9.5).font("Helvetica-Bold").text(
          "Omitted / Failed Pages:",
          { width: pageWidth }
        );
        doc.moveDown(0.3);
        for (const fp of failedPages.slice(0, 8)) {
          doc.fillColor("#744210").fontSize(8.5).font("Helvetica").text(
            `• ${fp.url} (${fp.error})`,
            { width: pageWidth }
          );
        }
        if (failedPages.length > 8) {
          doc.fillColor("#744210").fontSize(8.5).font("Helvetica").text(
            `• ...and ${failedPages.length - 8} additional failed pages.`,
            { width: pageWidth }
          );
        }
      }

      doc.moveDown(3);
      doc.fillColor("#a0aec0").fontSize(8.5).font("Helvetica").text(
        "Generated by Docu — Deterministic Documentation Converter",
        { align: "center", width: pageWidth }
      );

      // ==========================================
      // 2. PRE-ALLOCATE TABLE OF CONTENTS PAGES
      // ==========================================
      // Count how many TOC items we will have (chapters + up to 5 h2 subheadings per chapter)
      let estimatedTocItems = 0;
      for (const page of pages) {
        estimatedTocItems += 1; // Chapter entry
        const h2Count = page.blocks.filter((b) => b.type === "heading" && b.level === 2).slice(0, 5).length;
        estimatedTocItems += h2Count;
      }

      const ITEMS_PER_TOC_PAGE = 26;
      const tocPagesCount = Math.max(1, Math.ceil(estimatedTocItems / ITEMS_PER_TOC_PAGE));
      const tocPageIndices: number[] = [];

      for (let t = 0; t < tocPagesCount; t++) {
        doc.addPage();
        tocPageIndices.push(doc.bufferedPageRange().count - 1);
      }

      const tocEntries: TocEntry[] = [];

      // ==========================================
      // 3. DOCUMENTATION CONTENT PAGES
      // ==========================================
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        doc.addPage();
        const currentPageNum = doc.bufferedPageRange().count;
        const chapterDestId = `chapter_${i + 1}`;

        // Add named destination and PDF outline bookmark for chapter
        doc.addNamedDestination(chapterDestId);
        const chapterOutline = doc.outline.addItem(`${i + 1}. ${page.title}`);

        tocEntries.push({
          title: page.title,
          level: 1,
          destId: chapterDestId,
          pageNumber: currentPageNum,
          chapterIndex: i + 1,
        });

        // Section Title
        doc.fillColor("#2b6cb0").fontSize(18).font("Helvetica-Bold").text(
          `${i + 1}. ${page.title}`,
          { width: pageWidth }
        );
        doc.moveDown(0.25);

        // Source link for this page
        doc.fillColor("#718096").fontSize(8.5).font("Helvetica").text(page.url, {
          link: page.url,
          underline: true,
          width: pageWidth,
        });
        doc.moveDown(0.5);

        // Section divider
        doc.strokeColor("#cbd5e0").lineWidth(1).moveTo(doc.x, doc.y).lineTo(doc.x + pageWidth, doc.y).stroke();
        doc.moveDown(0.9);

        let skippedDuplicateH1 = false;
        let h2Counter = 0;

        // Render Content Blocks
        for (const block of page.blocks) {
          // Avoid printing the page title twice if the first H1 matches page.title
          if (
            !skippedDuplicateH1 &&
            block.type === "heading" &&
            block.level === 1 &&
            block.text.trim().toLowerCase() === page.title.trim().toLowerCase()
          ) {
            skippedDuplicateH1 = true;
            continue;
          }

          // Register H2 headings in TOC and PDF Outline
          let headingDestId: string | undefined;
          if (block.type === "heading" && block.level === 2) {
            h2Counter++;
            if (h2Counter <= 5) {
              headingDestId = `chapter_${i + 1}_h2_${h2Counter}`;
            }
            chapterOutline.addItem(block.text);
          }

          renderBlock(doc, block, pageWidth, maxContentY, headingDestId, tocEntries);
        }
      }

      // ==========================================
      // 4. POPULATE TABLE OF CONTENTS
      // ==========================================
      let currentTocPageIdx = 0;
      let itemsOnCurrentTocPage = 0;

      const initTocPage = (tocPageSlot: number, isContinuation: boolean) => {
        doc.switchToPage(tocPageIndices[tocPageSlot]);
        doc.x = doc.page.margins.left;
        doc.y = doc.page.margins.top;

        doc.fillColor("#1a202c").fontSize(20).font("Helvetica-Bold").text(
          isContinuation ? "Table of Contents (Continued)" : "Table of Contents",
          { width: pageWidth }
        );
        doc.moveDown(0.4);
        doc.strokeColor("#e2e8f0").lineWidth(1).moveTo(doc.x, doc.y).lineTo(doc.x + pageWidth, doc.y).stroke();
        doc.moveDown(1);
      };

      initTocPage(0, false);

      for (const entry of tocEntries) {
        if (itemsOnCurrentTocPage >= ITEMS_PER_TOC_PAGE && currentTocPageIdx + 1 < tocPageIndices.length) {
          currentTocPageIdx++;
          itemsOnCurrentTocPage = 0;
          initTocPage(currentTocPageIdx, true);
        }

        const itemY = doc.y;
        const isChapter = entry.level === 1;
        const indentX = isChapter ? doc.page.margins.left : doc.page.margins.left + 18;
        const labelText = isChapter
          ? `${entry.chapterIndex}.  ${entry.title}`
          : `•  ${entry.title}`;

        doc.fillColor(isChapter ? "#1a202c" : "#4a5568")
          .fontSize(isChapter ? 10.5 : 9.5)
          .font(isChapter ? "Helvetica-Bold" : "Helvetica")
          .text(labelText, indentX, itemY, {
            width: pageWidth - (isChapter ? 45 : 63),
            lineBreak: false,
            ellipsis: true,
            goTo: entry.destId,
          });

        doc.fillColor(isChapter ? "#2b6cb0" : "#718096")
          .fontSize(isChapter ? 10 : 9)
          .font(isChapter ? "Helvetica-Bold" : "Helvetica")
          .text(
            `${entry.pageNumber}`,
            doc.page.width - doc.page.margins.right - 35,
            itemY,
            { align: "right", width: 35, goTo: entry.destId }
          );

        doc.y = itemY + (isChapter ? 19 : 16);
        itemsOnCurrentTocPage++;
      }

      // ==========================================
      // 5. RUNNING HEADERS & FOOTERS
      // ==========================================
      const totalPages = doc.bufferedPageRange().count;
      recordedPageCount = totalPages;

      for (let p = 0; p < totalPages; p++) {
        doc.switchToPage(p);

        // Skip header/footer on title page
        if (p === 0) continue;

        const savedTopMargin = doc.page.margins.top;
        const savedBottomMargin = doc.page.margins.bottom;
        doc.page.margins.top = 0;
        doc.page.margins.bottom = 0;

        // Running Header
        const headerTitle = isPartial ? `${siteTitle.toUpperCase()} [PARTIAL]` : siteTitle.toUpperCase();
        doc.fillColor("#a0aec0").fontSize(7.5).font("Helvetica").text(
          headerTitle,
          doc.page.margins.left,
          24,
          { width: pageWidth, align: "left", lineBreak: false }
        );
        doc.strokeColor("#edf2f7").lineWidth(0.5).moveTo(doc.page.margins.left, 36).lineTo(doc.page.margins.left + pageWidth, 36).stroke();

        // Running Footer
        const footerLineY = doc.page.height - 40;
        doc.strokeColor("#edf2f7").lineWidth(0.5).moveTo(doc.page.margins.left, footerLineY).lineTo(doc.page.margins.left + pageWidth, footerLineY).stroke();
        doc.fillColor("#718096").fontSize(8).font("Helvetica").text(
          `Page ${p + 1} of ${totalPages}`,
          doc.page.margins.left,
          doc.page.height - 30,
          { width: pageWidth, align: "right", lineBreak: false }
        );
        doc.fillColor("#a0aec0").fontSize(8).font("Helvetica").text(
          "Docu Offline Manual",
          doc.page.margins.left,
          doc.page.height - 30,
          { width: pageWidth, align: "left", lineBreak: false }
        );

        doc.page.margins.top = savedTopMargin;
        doc.page.margins.bottom = savedBottomMargin;
      }

      doc.end();
    } catch (err: unknown) {
      reject(err);
    }
  });
}

function renderBlock(
  doc: typeof PDFDocument.prototype,
  block: ContentBlock,
  pageWidth: number,
  maxContentY: number,
  headingDestId?: string,
  tocEntries?: TocEntry[]
): void {
  // Ensure minimum space near page bottom before starting a new block
  if (doc.y > maxContentY - 30) {
    doc.addPage();
  }

  switch (block.type) {
    case "heading": {
      const sizes: Record<number, number> = { 1: 16, 2: 13.5, 3: 11.5, 4: 10.5, 5: 10, 6: 9.5 };
      const fontSize = sizes[block.level] || 11;

      doc.fontSize(fontSize).font("Helvetica-Bold");
      const headingHeight = doc.heightOfString(block.text, { width: pageWidth });
      // Prevent orphan headings at the bottom of a page (keep at least 45pt for following content)
      if (doc.y + headingHeight + 45 > maxContentY) {
        doc.addPage();
      } else {
        doc.moveDown(0.7);
      }

      if (headingDestId && tocEntries) {
        doc.addNamedDestination(headingDestId);
        tocEntries.push({
          title: block.text,
          level: 2,
          destId: headingDestId,
          pageNumber: doc.bufferedPageRange().count,
        });
      }

      doc.fillColor("#1a202c").fontSize(fontSize).font("Helvetica-Bold").text(block.text, {
        width: pageWidth,
      });
      doc.moveDown(0.35);
      break;
    }

    case "paragraph": {
      doc.fillColor("#2d3748").fontSize(10).font("Helvetica").text(block.text, {
        width: pageWidth,
        lineGap: 2.5,
      });

      // Preserve clickable links referenced within the paragraph
      if (block.links && block.links.length > 0) {
        const uniqueLinks = block.links.slice(0, 4);
        for (const lnk of uniqueLinks) {
          if (doc.y > maxContentY - 15) {
            doc.addPage();
          }
          doc.fillColor("#3182ce").fontSize(8.5).font("Helvetica").text(
            `↗ ${lnk.text}: ${lnk.href}`,
            doc.page.margins.left + 8,
            doc.y + 1,
            {
              width: pageWidth - 8,
              link: lnk.href,
              underline: true,
            }
          );
        }
        doc.x = doc.page.margins.left;
      }

      doc.moveDown(0.55);
      break;
    }

    case "code": {
      doc.moveDown(0.35);
      const codeLines = block.code.split("\n");
      const innerWidth = pageWidth - 20;

      doc.fontSize(8.5).font("Courier");

      let lineIdx = 0;
      let isContinuation = false;

      while (lineIdx < codeLines.length) {
        // Ensure at least 55pt available to start a code chunk
        if (doc.y + 55 > maxContentY) {
          doc.addPage();
        }

        const chunkStartY = doc.y;
        const availableHeight = maxContentY - chunkStartY - 16;
        const chunkLines: string[] = [];
        let chunkTextHeight = 0;

        while (lineIdx < codeLines.length) {
          const line = codeLines[lineIdx] || " ";
          const h = doc.heightOfString(line, { width: innerWidth }) + 1.5;
          if (chunkLines.length > 0 && chunkTextHeight + h > availableHeight) {
            break;
          }
          chunkLines.push(line);
          chunkTextHeight += h;
          lineIdx++;
        }

        const boxHeight = Math.max(chunkTextHeight + 16, 24);
        const boxX = doc.page.margins.left;

        // Draw code background and border
        doc.roundedRect(boxX, chunkStartY, pageWidth, boxHeight, 4).fill("#f7fafc");
        doc.roundedRect(boxX, chunkStartY, pageWidth, boxHeight, 4).strokeColor("#e2e8f0").lineWidth(0.75).stroke();

        // Draw language tag or continuation label
        const badgeText = isContinuation
          ? `${(block.language || "CODE").toUpperCase()} (CONT.)`
          : block.language
          ? block.language.toUpperCase()
          : "";

        if (badgeText) {
          doc.fillColor("#a0aec0").fontSize(6.5).font("Helvetica-Bold").text(
            badgeText,
            boxX + pageWidth - 95,
            chunkStartY + 5,
            { width: 88, align: "right", lineBreak: false }
          );
        }

        // Render code lines inside chunk box
        doc.fillColor("#1a202c").fontSize(8.5).font("Courier");
        let currentY = chunkStartY + 9;
        for (const line of chunkLines) {
          doc.text(line, boxX + 10, currentY, {
            width: innerWidth,
            lineBreak: true,
          });
          currentY += doc.heightOfString(line, { width: innerWidth }) + 1.5;
        }

        doc.x = doc.page.margins.left;
        doc.y = chunkStartY + boxHeight;

        if (lineIdx < codeLines.length) {
          doc.addPage();
          isContinuation = true;
        }
      }

      doc.moveDown(0.55);
      break;
    }

    case "list": {
      doc.moveDown(0.25);
      const nestOffset = (block.indent || 0) * 16;

      for (let i = 0; i < block.items.length; i++) {
        const bullet = block.ordered ? `${i + 1}.` : (block.indent ? "◦" : "•");
        const itemText = block.items[i];

        doc.fontSize(10).font("Helvetica");
        const itemHeight = doc.heightOfString(itemText, { width: pageWidth - 28 - nestOffset });
        if (doc.y + itemHeight > maxContentY) {
          doc.addPage();
        }

        const rowY = doc.y;
        doc.fillColor("#4a5568").fontSize(10).font("Helvetica-Bold").text(
          bullet,
          doc.page.margins.left + 6 + nestOffset,
          rowY,
          { width: 20, lineBreak: false }
        );
        doc.fillColor("#2d3748").fontSize(10).font("Helvetica").text(
          itemText,
          doc.page.margins.left + 26 + nestOffset,
          rowY,
          { width: pageWidth - 28 - nestOffset, lineGap: 2 }
        );
        doc.x = doc.page.margins.left;
        doc.moveDown(0.25);
      }
      doc.moveDown(0.45);
      break;
    }

    case "callout": {
      doc.moveDown(0.4);
      const calloutColors: Record<string, { bg: string; border: string; title: string }> = {
        note: { bg: "#ebf8ff", border: "#3182ce", title: "NOTE" },
        tip: { bg: "#f0fff4", border: "#38a169", title: "TIP" },
        warning: { bg: "#fffaf0", border: "#dd6b20", title: "WARNING" },
        caution: { bg: "#fff5f5", border: "#e53e3e", title: "CAUTION" },
        info: { bg: "#ebf8ff", border: "#3182ce", title: "INFO" },
      };

      const theme = calloutColors[block.variant] || calloutColors.note;
      const boxX = doc.page.margins.left;

      doc.fontSize(9.5).font("Helvetica");
      const textHeight = doc.heightOfString(block.text, { width: pageWidth - 24, lineGap: 2 });
      const boxHeight = Math.min(textHeight + 28, maxContentY - doc.page.margins.top - 20);

      if (doc.y + boxHeight > maxContentY) {
        doc.addPage();
      }

      const finalY = doc.y;
      doc.roundedRect(boxX, finalY, pageWidth, boxHeight, 3).fill(theme.bg);
      doc.rect(boxX, finalY, 4, boxHeight).fill(theme.border);

      doc.fillColor(theme.border).fontSize(8).font("Helvetica-Bold").text(theme.title, boxX + 12, finalY + 8);
      doc.fillColor("#2d3748").fontSize(9.5).font("Helvetica").text(block.text, boxX + 12, finalY + 20, {
        width: pageWidth - 24,
        height: boxHeight - 24,
        lineGap: 2,
      });

      doc.x = doc.page.margins.left;
      doc.y = finalY + boxHeight;
      doc.moveDown(0.55);
      break;
    }

    case "table": {
      doc.moveDown(0.5);
      const hasHeaders = block.headers.length > 0;
      const allRows = hasHeaders ? [block.headers, ...block.rows] : block.rows;
      if (allRows.length === 0) break;

      const colCount = Math.max(...allRows.map((r) => r.length), 1);
      const colWidths = computeColumnWidths(allRows, colCount, pageWidth);

      const measureRowHeight = (row: string[], isHeader: boolean): number => {
        doc.fontSize(8.5).font(isHeader ? "Helvetica-Bold" : "Helvetica");
        let maxH = 18;
        for (let c = 0; c < colCount; c++) {
          const cellText = row[c] || "";
          const h = doc.heightOfString(cellText, { width: Math.max(colWidths[c] - 8, 20), lineGap: 1.5 }) + 8;
          if (h > maxH) maxH = h;
        }
        return Math.min(maxH, 260);
      };

      const drawRow = (row: string[], yPos: number, rowHeight: number, isHeader: boolean, isOddDataRow: boolean) => {
        if (isHeader) {
          doc.rect(doc.page.margins.left, yPos, pageWidth, rowHeight).fill("#edf2f7");
        } else if (isOddDataRow) {
          doc.rect(doc.page.margins.left, yPos, pageWidth, rowHeight).fill("#f7fafc");
        }

        let currentX = doc.page.margins.left;
        for (let c = 0; c < colCount; c++) {
          const cw = colWidths[c];
          const cellText = row[c] || "";

          doc.rect(currentX, yPos, cw, rowHeight).strokeColor("#cbd5e0").lineWidth(0.5).stroke();
          doc.fillColor(isHeader ? "#1a202c" : "#2d3748")
            .fontSize(8.5)
            .font(isHeader ? "Helvetica-Bold" : "Helvetica")
            .text(cellText, currentX + 4, yPos + 4, {
              width: Math.max(cw - 8, 20),
              height: rowHeight - 6,
              lineGap: 1.5,
              ellipsis: true,
            });

          currentX += cw;
        }
      };

      let tableY = doc.y;
      if (tableY + 50 > maxContentY) {
        doc.addPage();
        tableY = doc.y;
      }

      const headerHeight = hasHeaders ? measureRowHeight(block.headers, true) : 0;

      for (let r = 0; r < allRows.length; r++) {
        const row = allRows[r];
        const isHeader = r === 0 && hasHeaders;
        const rowHeight = isHeader ? headerHeight : measureRowHeight(row, false);

        // Page break handling with repeated table headers
        if (tableY + rowHeight > maxContentY) {
          doc.addPage();
          tableY = doc.y;

          // Repeat table headers on new page
          if (hasHeaders && !isHeader) {
            drawRow(block.headers, tableY, headerHeight, true, false);
            tableY += headerHeight;
          }
        }

        drawRow(row, tableY, rowHeight, isHeader, !isHeader && r % 2 === 1);
        tableY += rowHeight;
      }

      doc.x = doc.page.margins.left;
      doc.y = tableY;
      doc.moveDown(0.65);
      break;
    }

    case "image": {
      doc.moveDown(0.4);
      const boxX = doc.page.margins.left;

      if (block.data) {
        const dims = getImageDimensions(block.data);
        const maxImgWidth = pageWidth - 20;
        const maxImgHeight = 220;

        let targetW = Math.min(320, maxImgWidth);
        let targetH = 160;

        if (dims) {
          const scale = Math.min(1, maxImgWidth / dims.width, maxImgHeight / dims.height);
          targetW = Math.max(Math.round(dims.width * scale), 24);
          targetH = Math.max(Math.round(dims.height * scale), 24);
        }

        if (doc.y + targetH + 28 > maxContentY) {
          doc.addPage();
        }

        try {
          const imgX = boxX + (pageWidth - targetW) / 2;
          const imgY = doc.y;
          doc.image(block.data, imgX, imgY, {
            width: targetW,
            height: targetH,
          });
          doc.y = imgY + targetH + 4;

          if (block.alt) {
            doc.fillColor("#718096").fontSize(8.5).font("Helvetica-Oblique").text(
              `Figure: ${block.alt}`,
              boxX,
              doc.y,
              { width: pageWidth, align: "center" }
            );
          }
          doc.x = boxX;
          doc.moveDown(0.5);
          break;
        } catch {
          // If PDFKit fails to decode image buffer, fall through to reference link box
        }
      }

      // Clean reference box for unembedded/vector images (e.g. SVG)
      if (doc.y + 36 > maxContentY) {
        doc.addPage();
      }
      const refY = doc.y;
      const label = block.alt ? `[Image: ${block.alt}]` : "[External Illustration / Diagram]";
      doc.roundedRect(boxX, refY, pageWidth, 28, 3).fill("#f7fafc");
      doc.roundedRect(boxX, refY, pageWidth, 28, 3).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
      doc.fillColor("#4a5568").fontSize(8.5).font("Helvetica-Bold").text(label, boxX + 10, refY + 5, {
        width: pageWidth - 20,
        lineBreak: false,
        ellipsis: true,
      });
      doc.fillColor("#3182ce").fontSize(8).font("Helvetica").text(block.src, boxX + 10, refY + 16, {
        width: pageWidth - 20,
        link: block.src,
        underline: true,
        lineBreak: false,
        ellipsis: true,
      });
      doc.x = boxX;
      doc.y = refY + 32;
      doc.moveDown(0.35);
      break;
    }

    case "hr": {
      doc.moveDown(0.5);
      doc.strokeColor("#e2e8f0").lineWidth(0.5).moveTo(doc.x, doc.y).lineTo(doc.x + pageWidth, doc.y).stroke();
      doc.moveDown(0.5);
      break;
    }

    default:
      break;
  }
}
