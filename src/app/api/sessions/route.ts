import { NextRequest } from 'next/server';

export async function GET() {
  // TODO: implement session listing
  return Response.json({ sessions: [] });
}

export async function POST(request: NextRequest) {
  // TODO: implement session creation
  return Response.json({ id: 'placeholder' });
}