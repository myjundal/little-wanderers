import { randomUUID } from 'crypto';
import { requireStaffContext } from '@/lib/authz';

export const dynamic = 'force-dynamic';

const BUCKET = 'email-campaign-assets';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function extensionForType(type: string) {
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/png') return 'png';
  if (type === 'image/gif') return 'gif';
  if (type === 'image/webp') return 'webp';
  return 'bin';
}

function safeFolder(input: FormDataEntryValue | null) {
  const value = typeof input === 'string' ? input : '';
  return /^[0-9a-f-]{36}$/i.test(value) ? value : 'general';
}

async function ensureBucket(context: Awaited<ReturnType<typeof requireStaffContext>> & { ok: true }) {
  const { error } = await context.admin.storage.createBucket(BUCKET, {
    public: true,
    allowedMimeTypes: [...ALLOWED_TYPES],
    fileSizeLimit: MAX_BYTES,
  });

  if (error && !/already exists|duplicate/i.test(error.message)) {
    throw new Error(error.message);
  }
}

export async function POST(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const form = await req.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return Response.json({ ok: false, error: 'Image file is required.' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return Response.json({ ok: false, error: 'Please use PNG, JPG, GIF, or WebP images.' }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return Response.json({ ok: false, error: 'Images must be 5 MB or smaller.' }, { status: 400 });
    }

    await ensureBucket(context);

    const folder = safeFolder(form.get('campaign_id'));
    const path = `${folder}/${Date.now()}-${randomUUID()}.${extensionForType(file.type)}`;
    const bytes = await file.arrayBuffer();
    const { error: uploadError } = await context.admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type,
      upsert: false,
    });

    if (uploadError) throw new Error(uploadError.message);

    const { data } = context.admin.storage.from(BUCKET).getPublicUrl(path);
    return Response.json({ ok: true, url: data.publicUrl, path });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
