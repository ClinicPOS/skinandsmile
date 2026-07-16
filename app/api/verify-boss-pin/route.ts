import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";

const BOSS_PIN_HASH = "$2b$10$juQo.K2bq2qfmr07RKn8S.mNImJ8/WhlG5iXGqHkRpBMCBiGtFGUu";

export async function POST(req: NextRequest) {
  const { pin } = await req.json();
  if (!pin) return NextResponse.json({ valid: false });
  const valid = await bcrypt.compare(pin, BOSS_PIN_HASH);
  return NextResponse.json({ valid });
}
