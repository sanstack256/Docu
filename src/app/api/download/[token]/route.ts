import { NextResponse } from "next/server";
import { getPDFByDownloadToken } from "@/lib/jobs";

export async function GET(
  _request: Request,
  { params }: { params: { token: string } }
) {
  const token = params.token;
  const fileData = getPDFByDownloadToken(token);

  if (!fileData) {
    return new NextResponse("File not found or download link has expired.", { status: 404 });
  }

  return new NextResponse(new Uint8Array(fileData.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileData.fileName}"`,
      "Content-Length": fileData.buffer.byteLength.toString(),
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
