import { NextResponse } from 'next/server';
import { getLocaleSetting } from '@/lib/settings-storage';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const locale = await getLocaleSetting();
    return NextResponse.json({ locale });
  } catch (error) {
    return NextResponse.json(
      { locale: undefined, error: 'settings_unavailable' },
      { status: 500 },
    );
  }
}
