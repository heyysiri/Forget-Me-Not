import { pipe } from "@screenpipe/js";
import { NextResponse } from "next/server";
// Define GET API function
export async function GET() {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    // Query Screenpipe for Audio + OCR data
    const results = await pipe.queryScreenpipe({
      contentType: "audio",
      startTime: oneHourAgo,
      endTime: now,
    });


    if (results) {
      return NextResponse.json({ success: true, data: results.data });
    } else {
      return NextResponse.json({ success: false, error: "No data found" });
    }
  } catch (error) {
    console.error("Screenpipe Query Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}