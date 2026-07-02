import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";

const BOSS_PIN_HASH = "$2b$10$Ptmc/LcRtgXMk0oFLCPrR.ubhQQGCk65M1WhV8rIO9P0nboqJiuoK";

export async function POST(req: NextRequest) {
  const { pin } = await req.json();
  if (!pin) return NextResponse.json({ valid: false });
  const valid = await bcrypt.compare(pin, BOSS_PIN_HASH);
  return NextResponse.json({ valid });
}
