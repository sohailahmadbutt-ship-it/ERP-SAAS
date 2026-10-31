'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { api, Contact, Page } from '@/lib/api';

type Form = {
  kind: 'COMPANY' | 'PERSON';
  name: string;
  parentId: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  taxId: string;
  isCustomer: boolean;
  isVendor: boolean;
  creditLimit: string;
  notes: string;
};

const EMPTY: Form = {
  kind: 'COMPANY', name: '', parentId: '', email: '', phone: '', address: '', city: '', country: '',
  taxId: '', isCustomer: true, isVendor: false, creditLimit: '', notes: '',
};

const toForm = (c: Contact): Form => ({
  kind: c.kind, name: c.name, parentId: c.parentId ?? '', email: c.email ?? '', phone: c.phone ?? '',
  address: c.address ?? '', city: c.city ?? '', country: c.country ?? '', taxId: c.taxId ?? '',
  isCustomer: c.isCustomer, isVendor: c.isVendor, creditLimit: c.creditLimit ?? '', notes: c.notes ?? '',
});

/** Empty text fields become null so they clear the stored value. */
const toBody = (f: Form) => ({
  ...f,
  parentId: f.kind === 'PERSON' && f.parentId ? f.parentId : null,
  email: f.email || null, phone: f.phone || null, address: f.address || null, city: f.city || null,
  country: f.country || null, taxId: f.taxId || null, notes: f.notes || null,
  creditLimit: f.creditLimit === '' ? null : Number(f.creditLimit),
});

export default function ContactPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === 'new';
  const [form, setForm] = useState<Form>(EMPTY);
  const [contact, setContact] = useState<Contact>();
  const [companies, setCompanies] = useState<Contact[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!isNew) {
      api<Contact>(`/contacts/${id}`).then((c) => { setContact(c); setForm(toForm(c)); }).catch((e) => setError(e.message));
    }
    // Companies a person can be linked to. Fine for now; becomes a search box when lists grow.
    api<Page<Contact>>('/contacts?pageSize=200')
      .then((p) => setCompanies(p.items.filter((c) => c.kind === 'COMPANY' && c.id !== id)))
      .catch(() => {});
  }, [id, isNew]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      if (isNew) {
        const c = await api<Contact>('/contacts', { method: 'POST', body: toBody(form) });
        router.replace(`/app/contacts/${c.id}`);
      } else {
        const c = await api<Contact>(`/contacts/${id}`, { method: 'PATCH', body: toBody(form) });
        setContact({ ...contact, ...c });
        setMsg('Saved');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggleArchive() {
    if (!contact) return;
    try {
      const c = await api<Contact>(`/contacts/${id}`, { method: 'PATCH', body: { archived: !contact.archived } });
      setContact({ ...contact, ...c });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const text = (k: keyof Form, label: string, type = 'text') => (
    <div>
      <label>{label}</label>
      <input type={type} value={form[k] as string} onChange={(e) => set(k, e.target.value as never)} />
    </div>
  );

  return (
    <>
      <p><Link href="/app/contacts">← Contacts</Link></p>
      <section className="card" style={{ maxWidth: 720 }}>
        <h2>{isNew ? 'New contact' : form.name}{contact?.archived && <span className="muted"> (archived)</span>}</h2>
        <form onSubmit={save}>
          <div className="row">
            <div>
              <label>Type</label>
              <select value={form.kind} onChange={(e) => set('kind', e.target.value as Form['kind'])}>
                <option value="COMPANY">Company</option>
                <option value="PERSON">Person</option>
              </select>
            </div>
            <div style={{ flex: 2 }}>
              <label>Name</label>
              <input required value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
          </div>
          {form.kind === 'PERSON' && (
            <div>
              <label>Works at</label>
              <select value={form.parentId} onChange={(e) => set('parentId', e.target.value)}>
                <option value="">None</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div className="row">{text('email', 'Email', 'email')}{text('phone', 'Phone')}</div>
          {text('address', 'Address')}
          <div className="row">{text('city', 'City')}{text('country', 'Country (2-letter code)')}{text('taxId', 'Tax number')}</div>
          <div className="row">
            <label style={{ flex: '0 0 auto' }}><input type="checkbox" style={{ width: 'auto' }} checked={form.isCustomer} onChange={(e) => set('isCustomer', e.target.checked)} /> Customer</label>
            <label style={{ flex: '0 0 auto' }}><input type="checkbox" style={{ width: 'auto' }} checked={form.isVendor} onChange={(e) => set('isVendor', e.target.checked)} /> Vendor</label>
            {text('creditLimit', 'Credit limit', 'number')}
          </div>
          <label>Notes</label>
          <textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          <div className="row">
            <button>{isNew ? 'Create' : 'Save'}</button>
            {!isNew && contact && (
              <button type="button" className="secondary" onClick={toggleArchive}>{contact.archived ? 'Restore' : 'Archive'}</button>
            )}
          </div>
          {msg && <p>{msg}</p>}
          {error && <p className="error">{error}</p>}
        </form>
      </section>

      {contact?.kind === 'COMPANY' && (
        <section className="card" style={{ maxWidth: 720, marginTop: 16 }}>
          <h3>People</h3>
          {contact.children?.length ? (
            <ul>{contact.children.map((p) => <li key={p.id}><Link href={`/app/contacts/${p.id}`}>{p.name}</Link> {p.email && <span className="muted">· {p.email}</span>}</li>)}</ul>
          ) : (
            <p className="muted">No people linked yet. Create a person contact and pick this company under Works at.</p>
          )}
        </section>
      )}
    </>
  );
}
