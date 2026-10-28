import { NextResponse } from "next/server";
import { getPDFByDownloadToken } from "@/lib/jobs";

export async function GET(
  _request: Request,
  { params }: { params: { token: string } }
) {
  const token = params.token || "";
  if (!/^[a-f0-9]{48}$/i.test(token)) {
    return new NextResponse("Invalid download token.", { status: 400 });
  }

  const fileData = getPDFByDownloadToken(token);

  if (!fileData) {
    return new NextResponse("File not found or download link has expired.", { status: 404 });
  }

  const safeFileName = fileData.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");

  return new NextResponse(new Uint8Array(fileData.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeFileName}"`,
      "Content-Length": fileData.buffer.byteLength.toString(),
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
