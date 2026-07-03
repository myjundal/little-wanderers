'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type SendCounts = {
  sent: number;
  failed: number;
  queued: number;
};

type Campaign = {
  id: string;
  name: string;
  subject: string;
  preview_text: string;
  body_html: string;
  status: 'draft' | 'sending' | 'sent';
  test_sent_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  send_counts?: SendCounts;
};

type CampaignListResponse = {
  ok: boolean;
  items?: Campaign[];
  staff_email?: string;
  resend_configured?: boolean;
  error?: string;
};

type RecipientPreview = {
  count: number;
  sample: string[];
  batch_size?: number;
  batches?: number;
};

type ContactTagOption = {
  tag: string;
  count: number;
};

type ContactTagsResponse = {
  ok: boolean;
  total_count?: number;
  tags?: ContactTagOption[];
  error?: string;
};

type ContactItem = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  source: string;
  unsubscribed_at: string | null;
  bounced_at: string | null;
  complained_at: string | null;
  tags: string[];
};

type ContactsResponse = {
  ok: boolean;
  items?: ContactItem[];
  error?: string;
};

const panelStyle: React.CSSProperties = {
  border: '1px solid #eadff3',
  borderRadius: 18,
  background: '#fff',
  padding: 16,
  boxShadow: '0 16px 28px rgba(158,143,191,0.08)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid #ddd1ea',
  borderRadius: 12,
  padding: '10px 12px',
  color: '#4f3f82',
  background: '#fff',
};

const labelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  color: '#4f3f82',
  fontWeight: 700,
};

const primaryButton: React.CSSProperties = {
  border: 'none',
  borderRadius: 12,
  padding: '11px 14px',
  background: '#5f3da4',
  color: '#fff',
  fontWeight: 800,
  cursor: 'pointer',
};

const secondaryButton: React.CSSProperties = {
  border: '1px solid #d9c8f7',
  borderRadius: 12,
  padding: '10px 14px',
  background: '#fff',
  color: '#5f3da4',
  fontWeight: 800,
  cursor: 'pointer',
};

const dangerButton: React.CSSProperties = {
  border: '1px solid #efb4be',
  borderRadius: 12,
  padding: '10px 14px',
  background: '#fff7f8',
  color: '#9f2d43',
  fontWeight: 800,
  cursor: 'pointer',
};

const iconButtonStyle: React.CSSProperties = {
  border: '1px solid #d9c8f7',
  borderRadius: 10,
  padding: '8px 10px',
  background: '#fff',
  color: '#5f3da4',
  fontWeight: 800,
  cursor: 'pointer',
  minWidth: 40,
};

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function emptyCounts(): SendCounts {
  return { sent: 0, failed: 0, queued: 0 };
}

function getBrowserSiteUrl() {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

function isSafeImageUrl(input: string) {
  return /^https?:\/\//i.test(input) || input.startsWith('/');
}

function tagLabel(tag: string) {
  if (tag === 'customer') return 'Customers';
  if (tag === 'waitlist') return 'Waitlist';
  if (tag === 'party_early_access') return 'Party early access';
  return tag.replace(/[_:-]+/g, ' ');
}

function normalizeEditorHtml(input: string) {
  return input
    .replace(/font-family\s*:\s*[^;"']+;?/gi, '')
    .replace(/\sstyle=(["'])\s*\1/gi, '');
}

export default function CampaignAdmin() {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Campaign | null>(null);
  const [staffEmail, setStaffEmail] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [resendConfigured, setResendConfigured] = useState(false);
  const [contactTags, setContactTags] = useState<ContactTagOption[]>([]);
  const [totalContactCount, setTotalContactCount] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [recipientPreview, setRecipientPreview] = useState<RecipientPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showHtml, setShowHtml] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [contactTagDrafts, setContactTagDrafts] = useState<Record<string, string>>({});
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [bulkContactTag, setBulkContactTag] = useState('customer');
  const [newContactEmail, setNewContactEmail] = useState('');
  const [newContactTag, setNewContactTag] = useState('customer');
  const [showContactTools, setShowContactTools] = useState(false);

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === selectedId) ?? null,
    [campaigns, selectedId]
  );
  const draftId = draft?.id;
  const draftBodyHtml = draft?.body_html ?? '';

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    const res = await fetch('/api/admin/campaigns', { cache: 'no-store' });
    const json = (await res.json()) as CampaignListResponse;
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Unable to load campaigns.');
      setLoading(false);
      return;
    }

    const items = json.items ?? [];
    setCampaigns(items);
    setStaffEmail(json.staff_email ?? '');
    setTestEmail((current) => current || json.staff_email || '');
    setResendConfigured(Boolean(json.resend_configured));

    const nextSelected = selectedId && items.some((item) => item.id === selectedId) ? selectedId : items[0]?.id ?? null;
    setSelectedId(nextSelected);
    setDraft(items.find((item) => item.id === nextSelected) ?? null);
    setLoading(false);
  }, [selectedId]);

  const loadTags = useCallback(async () => {
    const res = await fetch('/api/admin/contact-tags', { cache: 'no-store' });
    const json = (await res.json()) as ContactTagsResponse;
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Unable to load contact tags.');
      return;
    }

    setContactTags(json.tags ?? []);
    setTotalContactCount(json.total_count ?? 0);
  }, []);

  const loadContacts = useCallback(async (query = '') => {
    const res = await fetch(`/api/admin/contacts?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
    const json = (await res.json()) as ContactsResponse;
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Unable to load contacts.');
      return;
    }

    setContacts(json.items ?? []);
    setSelectedContactIds([]);
  }, []);

  useEffect(() => {
    void load();
    void loadTags();
  }, [load, loadTags]);

  useEffect(() => {
    if (showContactTools && contacts.length === 0) {
      void loadContacts(contactSearch);
    }
  }, [showContactTools, contacts.length, contactSearch, loadContacts]);

  useEffect(() => {
    if (selectedCampaign) {
      setDraft(selectedCampaign);
      setConfirmed(false);
      setRecipientPreview(null);
    }
  }, [selectedCampaign]);

  useEffect(() => {
    if (!editorRef.current || !draftId) return;
    if (document.activeElement === editorRef.current) return;
    editorRef.current.innerHTML = draftBodyHtml;
  }, [draftId, draftBodyHtml]);

  const createCampaign = async () => {
    setBusy('create');
    setMessage(null);
    const res = await fetch('/api/admin/campaigns', { method: 'POST' });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Unable to create campaign.');
      setBusy(null);
      return;
    }
    setSelectedId(json.id);
    setBusy(null);
    await load();
  };

  const saveCampaign = async () => {
    if (!draft) return;
    setBusy('save');
    setMessage(null);
    const res = await fetch(`/api/admin/campaigns/${draft.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: draft.name,
        subject: draft.subject,
        preview_text: draft.preview_text,
        body_html: draft.body_html,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Unable to save campaign.');
      setBusy(null);
      return;
    }
    setDraft(json.campaign);
    setBusy(null);
    setMessage('Campaign saved.');
    await load();
  };

  const deleteCampaign = async () => {
    if (!draft) return;
    const ok = window.confirm(`Delete "${draft.name}"? This also removes its test/send history.`);
    if (!ok) return;

    setBusy('delete');
    setMessage(null);
    const res = await fetch(`/api/admin/campaigns/${draft.id}`, { method: 'DELETE' });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Unable to delete campaign.');
      setBusy(null);
      return;
    }

    setBusy(null);
    setMessage('Campaign deleted.');
    setSelectedId(null);
    setDraft(null);
    setRecipientPreview(null);
    setConfirmed(false);
    await load();
  };

  const previewRecipients = async () => {
    if (!draft) return;
    setBusy('preview');
    setMessage(null);
    const res = await fetch(`/api/admin/campaigns/${draft.id}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dry_run: true, tags: selectedTags }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Unable to preview recipients.');
      setBusy(null);
      return;
    }
    setRecipientPreview({
      count: json.recipient_count ?? 0,
      sample: json.sample ?? [],
      batch_size: json.batch_size,
      batches: json.batches,
    });
    setConfirmed(false);
    setBusy(null);
  };

  const sendTest = async () => {
    if (!draft) return;
    setBusy('test');
    setMessage(null);
    const res = await fetch(`/api/admin/campaigns/${draft.id}/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: testEmail || staffEmail }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Test send failed.');
      setBusy(null);
      return;
    }
    setBusy(null);
    setMessage('Test email sent.');
    await load();
  };

  const sendCampaign = async () => {
    if (!draft || !confirmed) return;
    const count = recipientPreview?.count ?? 0;
    const ok = window.confirm(`Send this campaign to ${count} recipient${count === 1 ? '' : 's'} now?`);
    if (!ok) return;

    setBusy('send');
    setMessage(null);
    const res = await fetch(`/api/admin/campaigns/${draft.id}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        confirm: true,
        tags: selectedTags,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Campaign send failed.');
      setBusy(null);
      return;
    }
    setBusy(null);
    setConfirmed(false);
    setRecipientPreview({
      count: json.recipient_count ?? 0,
      sample: [],
      batch_size: json.batch_size,
      batches: json.batches,
    });
    setMessage(`Sent: ${json.sent ?? 0}. Failed: ${json.failed ?? 0}. Skipped: ${json.skipped ?? 0}.`);
    await load();
  };

  const updateDraft = (patch: Partial<Campaign>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const updateBodyFromEditor = () => {
    const html = normalizeEditorHtml(editorRef.current?.innerHTML ?? '');
    updateDraft({ body_html: html.trim() ? html : '' });
  };

  const runEditorCommand = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    updateBodyFromEditor();
  };

  const insertHtml = (html: string) => {
    editorRef.current?.focus();
    document.execCommand('insertHTML', false, html);
    updateBodyFromEditor();
  };

  const insertImageHtml = (url: string, alt: string) => {
    insertHtml(
      `<p><img src="${url}" alt="${alt}" style="display:block;width:100%;max-width:560px;height:auto;margin:18px auto;border-radius:16px;" /></p>`
    );
  };

  const uploadImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setMessage('Please choose an image file.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setMessage('Images must be 5 MB or smaller.');
      return;
    }

    setUploadingImage(true);
    setMessage('Uploading image...');

    const form = new FormData();
    form.append('file', file);
    if (draft?.id) form.append('campaign_id', draft.id);

    const res = await fetch('/api/admin/campaign-assets', {
      method: 'POST',
      body: form,
    });
    const json = await res.json();

    setUploadingImage(false);

    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Unable to upload image.');
      return;
    }

    insertImageHtml(json.url, file.name || 'Little Wanderers image');
    setMessage('Image added.');
  };

  const addLink = () => {
    const url = window.prompt('Paste the link URL');
    if (!url) return;
    runEditorCommand('createLink', url);
  };

  const addImage = () => {
    const rawUrl = window.prompt('Paste an image URL');
    if (!rawUrl) return;

    const url = rawUrl.trim();
    if (!isSafeImageUrl(url)) {
      setMessage('Image URL must start with https://, http://, or /.');
      return;
    }

    const alt = window.prompt('Image description', 'Little Wanderers image')?.trim() || 'Little Wanderers image';
    const resolvedUrl = url.startsWith('/') ? `${getBrowserSiteUrl()}${url}` : url;

    insertImageHtml(resolvedUrl, alt);
  };

  const chooseImageFile = () => {
    imageInputRef.current?.click();
  };

  const handleImageInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void uploadImageFile(file);
  };

  const handleEditorPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/'));
    if (!image) return;
    event.preventDefault();
    void uploadImageFile(image);
  };

  const handleEditorDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const image = Array.from(event.dataTransfer.files).find((file) => file.type.startsWith('image/'));
    if (!image) return;
    event.preventDefault();
    void uploadImageFile(image);
  };

  const addLogo = () => {
    insertHtml(
      `<p style="text-align:center;"><img src="${getBrowserSiteUrl()}/logo.png" alt="Little Wanderers" style="display:inline-block;width:140px;max-width:60%;height:auto;margin:0 auto 14px;" /></p>`
    );
  };

  const makeHeading = () => {
    runEditorCommand('formatBlock', 'h2');
  };

  const makeParagraph = () => {
    runEditorCommand('formatBlock', 'p');
  };

  const currentCounts = selectedCampaign?.send_counts ?? emptyCounts();
  const audienceLabel = selectedTags.length === 0
    ? `All eligible contacts (${totalContactCount})`
    : selectedTags.map(tagLabel).join(', ');

  const toggleTag = (tag: string) => {
    setSelectedTags((current) => {
      const next = current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag];
      return next.sort((a, b) => a.localeCompare(b));
    });
    setRecipientPreview(null);
    setConfirmed(false);
  };

  const refreshContactTools = async (query = contactSearch) => {
    await Promise.all([loadTags(), loadContacts(query)]);
    setRecipientPreview(null);
    setConfirmed(false);
  };

  const normalizeTagDraft = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '_');

  const toggleContactSelection = (contactId: string) => {
    setSelectedContactIds((current) => (
      current.includes(contactId) ? current.filter((id) => id !== contactId) : [...current, contactId]
    ));
  };

  const toggleAllLoadedContacts = () => {
    setSelectedContactIds((current) => (
      current.length === contacts.length ? [] : contacts.map((contact) => contact.id)
    ));
  };

  const addManualContact = async () => {
    const email = newContactEmail.trim();
    const tag = normalizeTagDraft(newContactTag);
    if (!email) {
      setMessage('Enter an email to add.');
      return;
    }
    if (!tag) {
      setMessage('Enter at least one tag.');
      return;
    }

    setBusy('contact-add');
    setMessage(null);
    const res = await fetch('/api/admin/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, tags: [tag] }),
    });
    const json = await res.json();
    setBusy(null);

    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Unable to add contact.');
      return;
    }

    setNewContactEmail('');
    setNewContactTag('customer');
    setContactSearch(email);
    setContacts(json.items ?? []);
    await loadTags();
    setMessage('Contact tag saved.');
  };

  const updateContactTag = async (contactId: string, tag: string, action: 'add' | 'remove') => {
    const normalizedTag = normalizeTagDraft(tag);
    if (!normalizedTag) return;

    setBusy(`contact-tag-${contactId}`);
    setMessage(null);
    const res = await fetch(`/api/admin/contacts/${contactId}/tags`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tag: normalizedTag, action }),
    });
    const json = await res.json();
    setBusy(null);

    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Unable to update tag.');
      return;
    }

    setContactTagDrafts((current) => ({ ...current, [contactId]: '' }));
    await refreshContactTools();
  };

  const updateSelectedContactTags = async () => {
    const normalizedTag = normalizeTagDraft(bulkContactTag);
    if (selectedContactIds.length === 0) {
      setMessage('Select at least one contact first.');
      return;
    }
    if (!normalizedTag) {
      setMessage('Enter a tag for the selected contacts.');
      return;
    }

    setBusy('contact-bulk-tag');
    setMessage(null);
    const res = await fetch('/api/admin/contacts', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contact_ids: selectedContactIds, tag: normalizedTag, action: 'add' }),
    });
    const json = await res.json();
    setBusy(null);

    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Unable to update selected contacts.');
      return;
    }

    await refreshContactTools();
    setMessage(`Tag added to ${json.updated_count ?? selectedContactIds.length} selected contact${selectedContactIds.length === 1 ? '' : 's'}.`);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 16 }}>
      <section style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
          <h2 style={{ margin: 0, color: '#4f3f82' }}>Campaigns</h2>
          <button type="button" onClick={createCampaign} disabled={Boolean(busy)} style={secondaryButton}>
            {busy === 'create' ? 'Creating...' : '+ New'}
          </button>
        </div>

        <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
          {loading ? (
            <p style={{ color: '#6d6480' }}>Loading...</p>
          ) : campaigns.length === 0 ? (
            <p style={{ color: '#6d6480' }}>No campaigns yet.</p>
          ) : (
            campaigns.map((campaign) => {
              const counts = campaign.send_counts ?? emptyCounts();
              const active = campaign.id === selectedId;
              return (
                <button
                  type="button"
                  key={campaign.id}
                  onClick={() => setSelectedId(campaign.id)}
                  style={{
                    textAlign: 'left',
                    border: active ? '2px solid #a78bcb' : '1px solid #eadff3',
                    borderRadius: 14,
                    background: active ? '#fbf7ff' : '#fff',
                    padding: 12,
                    cursor: 'pointer',
                  }}
                >
                  <strong style={{ display: 'block', color: '#4f3f82' }}>{campaign.name}</strong>
                  <span style={{ display: 'block', color: '#6d6480', marginTop: 4 }}>{campaign.subject || '-'}</span>
                  <span style={{ display: 'block', color: '#8f85a5', marginTop: 6, fontSize: 12 }}>
                    {campaign.status} · sent {counts.sent} · failed {counts.failed}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <details
          open={showContactTools}
          onToggle={(event) => setShowContactTools(event.currentTarget.open)}
          style={{ marginTop: 18, borderTop: '1px solid #eadff3', paddingTop: 16 }}
        >
          <summary style={{ cursor: 'pointer', color: '#4f3f82', fontWeight: 800, fontSize: 20 }}>
            Manual tags
            <span style={{ display: 'block', color: '#8f85a5', fontSize: 12, fontWeight: 600, marginTop: 4 }}>
              Search contacts only when you need to tag people.
            </span>
          </summary>

          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8 }}>
              <input
                value={contactSearch}
                onChange={(event) => setContactSearch(event.target.value)}
                placeholder="Search email or name"
                style={inputStyle}
              />
              <button type="button" onClick={() => void loadContacts(contactSearch)} disabled={Boolean(busy)} style={secondaryButton}>
                Search
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 8, marginTop: 12, border: '1px solid #eadff3', borderRadius: 14, padding: 10, background: '#fbf7ff' }}>
            <strong style={{ color: '#4f3f82' }}>Add email + tag</strong>
            <input
              value={newContactEmail}
              onChange={(event) => setNewContactEmail(event.target.value)}
              placeholder="email@example.com"
              style={inputStyle}
            />
            <input
              value={newContactTag}
              onChange={(event) => setNewContactTag(event.target.value)}
              placeholder="tag_name"
              style={inputStyle}
            />
            <button type="button" onClick={addManualContact} disabled={Boolean(busy)} style={primaryButton}>
              {busy === 'contact-add' ? 'Saving...' : 'Add tag'}
            </button>
          </div>

          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            {contacts.length === 0 ? (
              <p style={{ color: '#6d6480', margin: 0 }}>No contacts loaded yet.</p>
            ) : (
              <>
                <div style={{ display: 'grid', gap: 8, border: '1px solid #eadff3', borderRadius: 14, padding: 10, background: '#fbf7ff' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4f3f82', fontWeight: 800 }}>
                    <input
                      type="checkbox"
                      checked={selectedContactIds.length === contacts.length}
                      onChange={toggleAllLoadedContacts}
                    />
                    Select all loaded ({contacts.length})
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
                    <input
                      value={bulkContactTag}
                      onChange={(event) => setBulkContactTag(event.target.value)}
                      placeholder="tag_name"
                      style={inputStyle}
                    />
                    <button type="button" onClick={updateSelectedContactTags} disabled={Boolean(busy) || selectedContactIds.length === 0} style={primaryButton}>
                      {busy === 'contact-bulk-tag' ? 'Saving...' : `Tag ${selectedContactIds.length}`}
                    </button>
                  </div>
                </div>

                {contacts.map((contact) => (
                  <article key={contact.id} style={{ border: '1px solid #eadff3', borderRadius: 14, padding: 10, background: '#fff' }}>
                    <label style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8, alignItems: 'start' }}>
                      <input
                        type="checkbox"
                        checked={selectedContactIds.includes(contact.id)}
                        onChange={() => toggleContactSelection(contact.id)}
                        style={{ marginTop: 3 }}
                      />
                      <span>
                        <strong style={{ display: 'block', color: '#4f3f82', overflowWrap: 'anywhere' }}>{contact.email}</strong>
                        <span style={{ display: 'block', color: '#8f85a5', fontSize: 12, marginTop: 2 }}>{contact.source}</span>
                      </span>
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {contact.tags.length === 0 ? (
                        <span style={{ color: '#6d6480', fontSize: 12 }}>No tags</span>
                      ) : contact.tags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => updateContactTag(contact.id, tag, 'remove')}
                          style={{ border: '1px solid #d9c8f7', borderRadius: 999, padding: '5px 8px', background: '#f8f3ff', color: '#5f3da4', cursor: 'pointer' }}
                        >
                          {tagLabel(tag)} x
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, marginTop: 8 }}>
                      <input
                        value={contactTagDrafts[contact.id] ?? ''}
                        onChange={(event) => setContactTagDrafts((current) => ({ ...current, [contact.id]: event.target.value }))}
                        placeholder="add_tag"
                        style={inputStyle}
                      />
                      <button
                        type="button"
                        onClick={() => updateContactTag(contact.id, contactTagDrafts[contact.id] ?? '', 'add')}
                        disabled={Boolean(busy)}
                        style={secondaryButton}
                      >
                        Add
                      </button>
                    </div>
                  </article>
                ))}
              </>
            )}
          </div>
        </details>
      </section>

      <section style={{ ...panelStyle, minWidth: 0 }}>
        {!draft ? (
          <p style={{ color: '#6d6480' }}>Create a campaign to begin.</p>
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <p style={{ margin: 0, color: '#7a63a5', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {draft.status}
                </p>
                <h2 style={{ margin: '6px 0 0', color: '#4f3f82' }}>{draft.name}</h2>
                <p style={{ margin: '6px 0 0', color: '#6d6480' }}>Tested: {formatDate(draft.test_sent_at)} · Sent: {formatDate(draft.sent_at)}</p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" onClick={saveCampaign} disabled={Boolean(busy)} style={primaryButton}>
                  {busy === 'save' ? 'Saving...' : 'Save'}
                </button>
                <button type="button" onClick={deleteCampaign} disabled={Boolean(busy)} style={dangerButton}>
                  {busy === 'delete' ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>

            {message && (
              <div style={{ border: '1px solid #d9c8f7', borderRadius: 12, padding: 12, background: '#fbf7ff', color: '#4f3f82' }}>
                {message}
              </div>
            )}

            {!resendConfigured && (
              <div style={{ border: '1px solid #f5c2c7', borderRadius: 12, padding: 12, background: '#fff5f5', color: '#7b2d2d' }}>
                RESEND_API_KEY is not configured.
              </div>
            )}

            <div style={{ display: 'grid', gap: 12 }}>
              <label style={labelStyle}>
                Campaign name
                <input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Subject
                <input value={draft.subject} onChange={(event) => updateDraft({ subject: event.target.value })} style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Preview text
                <input value={draft.preview_text} onChange={(event) => updateDraft({ preview_text: event.target.value })} style={inputStyle} />
              </label>
              <div style={labelStyle}>
                Body
                <div style={{ border: '1px solid #ddd1ea', borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, borderBottom: '1px solid #eadff3', background: '#fbf7ff', position: 'sticky', top: 0, zIndex: 2 }}>
                    <button type="button" aria-label="Bold" title="Bold" onClick={() => runEditorCommand('bold')} style={iconButtonStyle}>B</button>
                    <button type="button" aria-label="Italic" title="Italic" onClick={() => runEditorCommand('italic')} style={{ ...iconButtonStyle, fontStyle: 'italic' }}>I</button>
                    <button type="button" aria-label="Heading" title="Heading" onClick={makeHeading} style={iconButtonStyle}>H2</button>
                    <button type="button" aria-label="Paragraph" title="Paragraph" onClick={makeParagraph} style={iconButtonStyle}>P</button>
                    <button type="button" aria-label="Bulleted list" title="Bulleted list" onClick={() => runEditorCommand('insertUnorderedList')} style={iconButtonStyle}>List</button>
                    <button type="button" aria-label="Add link" title="Add link" onClick={addLink} style={iconButtonStyle}>Link</button>
                    <button type="button" aria-label="Insert logo" title="Insert logo" onClick={addLogo} style={iconButtonStyle}>Logo</button>
                    <button type="button" aria-label="Upload image" title="Upload image" onClick={chooseImageFile} disabled={uploadingImage} style={iconButtonStyle}>
                      {uploadingImage ? '...' : 'Upload'}
                    </button>
                    <button type="button" aria-label="Insert image URL" title="Insert image URL" onClick={addImage} style={iconButtonStyle}>URL</button>
                    <button type="button" aria-label="Remove formatting" title="Remove formatting" onClick={() => runEditorCommand('removeFormat')} style={iconButtonStyle}>Clear</button>
                    <button type="button" onClick={() => setShowHtml((current) => !current)} style={{ ...iconButtonStyle, marginLeft: 'auto' }}>
                      {showHtml ? 'Hide HTML' : 'HTML'}
                    </button>
                    <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={handleImageInputChange} hidden />
                  </div>
                  <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={updateBodyFromEditor}
                    onBlur={updateBodyFromEditor}
                    onPaste={handleEditorPaste}
                    onDrop={handleEditorDrop}
                    onDragOver={(event) => event.preventDefault()}
                    style={{
                      minHeight: 280,
                      padding: 16,
                      color: '#4f3f82',
                      fontFamily: 'Arial, Helvetica, sans-serif',
                      lineHeight: 1.65,
                      outline: 'none',
                      overflowWrap: 'anywhere',
                    }}
                  />
                </div>
                <span style={{ color: '#6d6480', fontSize: 13, fontWeight: 500 }}>
                  Paste a screenshot directly into the editor, drag an image in, or use Upload.
                </span>
                {showHtml && (
                  <textarea
                    value={draft.body_html}
                    onChange={(event) => updateDraft({ body_html: event.target.value })}
                    rows={8}
                    style={{ ...inputStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical' }}
                  />
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gap: 10, border: '1px solid #eadff3', borderRadius: 14, padding: 12 }}>
              <h3 style={{ margin: 0, color: '#4f3f82' }}>Recipients</h3>
              <details style={{ border: '1px solid #ddd1ea', borderRadius: 12, padding: 10, background: '#fff' }}>
                <summary style={{ cursor: 'pointer', color: '#4f3f82', fontWeight: 800 }}>
                  Audience: {audienceLabel}
                </summary>
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4f3f82', fontWeight: 700 }}>
                    <input
                      type="checkbox"
                      checked={selectedTags.length === 0}
                      onChange={() => {
                        setSelectedTags([]);
                        setRecipientPreview(null);
                        setConfirmed(false);
                      }}
                    />
                    All eligible contacts ({totalContactCount})
                  </label>
                  {contactTags.map((item) => (
                    <label key={item.tag} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4f3f82', fontWeight: 700 }}>
                      <input
                        type="checkbox"
                        checked={selectedTags.includes(item.tag)}
                        onChange={() => toggleTag(item.tag)}
                      />
                      {tagLabel(item.tag)} ({item.count})
                    </label>
                  ))}
                </div>
              </details>
              <button type="button" onClick={previewRecipients} disabled={Boolean(busy)} style={secondaryButton}>
                {busy === 'preview' ? 'Counting...' : 'Preview recipients'}
              </button>
              {recipientPreview && (
                <div style={{ color: '#6d6480', lineHeight: 1.6 }}>
                  <strong style={{ color: '#4f3f82' }}>{recipientPreview.count}</strong> recipients · {recipientPreview.batches ?? 0} batches of {recipientPreview.batch_size ?? 100}
                  {recipientPreview.sample.length > 0 && <div>Sample: {recipientPreview.sample.join(', ')}</div>}
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gap: 10, border: '1px solid #eadff3', borderRadius: 14, padding: 12 }}>
              <h3 style={{ margin: 0, color: '#4f3f82' }}>Test</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 10 }}>
                <input value={testEmail} onChange={(event) => setTestEmail(event.target.value)} style={inputStyle} />
                <button type="button" onClick={sendTest} disabled={Boolean(busy)} style={secondaryButton}>
                  {busy === 'test' ? 'Sending...' : 'Send test'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 10, border: '1px solid #eadff3', borderRadius: 14, padding: 12 }}>
              <h3 style={{ margin: 0, color: '#4f3f82' }}>Send</h3>
              <p style={{ margin: 0, color: '#6d6480' }}>
                Sent {currentCounts.sent} · failed {currentCounts.failed} · queued {currentCounts.queued}
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4f3f82', fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={!recipientPreview || recipientPreview.count === 0}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                Confirm send to {recipientPreview?.count ?? 0} recipients
              </label>
              <button
                type="button"
                onClick={sendCampaign}
                disabled={Boolean(busy) || !confirmed || !recipientPreview || recipientPreview.count === 0}
                style={{ ...primaryButton, background: confirmed ? '#5f3da4' : '#b8adc9' }}
              >
                {busy === 'send' ? 'Sending...' : 'Send campaign'}
              </button>
            </div>

            <div style={{ border: '1px solid #eadff3', borderRadius: 14, padding: 12 }}>
              <h3 style={{ marginTop: 0, color: '#4f3f82' }}>Preview</h3>
              <div
                style={{ color: '#4f3f82', borderTop: '1px solid #eadff3', paddingTop: 12, overflowWrap: 'anywhere', fontFamily: 'Arial, Helvetica, sans-serif' }}
                dangerouslySetInnerHTML={{ __html: draft.body_html || '<p></p>' }}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
