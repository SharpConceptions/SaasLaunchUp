"use client";

import { FormEvent, useEffect, useState } from "react";
import "./workspace.css";

type Organization = { id: string; name: string; legal_name: string | null; primary_domain: string | null; timezone: string; role: string };
type Contact = { id: string; name: string; email: string | null; phone: string | null; lifecycle_stage: string; company_name: string | null; source: string | null };
type Company = { id: string; name: string; domain: string | null };
type Task = { id: string; title: string; status: string; due_at: string | null };
type Stage = { pipeline_id: string; pipeline_name: string; stage_id: string; stage_name: string; position: number };
type Audit = { id: string; kind: string; target_type: string; created_at: string };
type Tab = "Contacts" | "Companies" | "Pipeline" | "Tasks" | "Organization" | "Audit history";
const tabs: Tab[] = ["Contacts", "Companies", "Pipeline", "Tasks", "Organization", "Audit history"];

async function crm(resource: string, method = "GET", tenantId?: string, data?: unknown) {
  const params = new URLSearchParams({ resource });
  if (tenantId) params.set("tenant_id", tenantId);
  const response = await fetch(`/api/crm?${params}`, {
    method,
    headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    credentials: "same-origin",
  });
  const payload = await response.json() as { error?: string; items?: unknown[]; id?: string };
  if (!response.ok) throw new Error(payload.error || "The CRM is unavailable.");
  return payload;
}

export default function FoundationPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [tab, setTab] = useState<Tab>("Contacts");
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const organization = organizations.find(item => item.id === tenantId);

  async function loadOrganizations() {
    try {
      setError("");
      const result = await crm("organizations");
      const items = (result.items || []) as Organization[];
      setOrganizations(items);
      setTenantId(previous => items.some(item => item.id === previous) ? previous : items[0]?.id || null);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "The CRM is unavailable.";
      if (text.includes("Sign in")) setNeedsSignIn(true);
      else setError(text);
    } finally { setLoading(false); }
  }
  useEffect(() => { void loadOrganizations(); }, []);
  useEffect(() => {
    if (!tenantId) return;
    let current = true;
    Promise.all([
      crm("contacts", "GET", tenantId), crm("companies", "GET", tenantId),
      crm("tasks", "GET", tenantId), crm("pipelines", "GET", tenantId),
      crm("audit", "GET", tenantId).catch(() => ({ items: [] })),
    ]).then(([a,b,c,d,e]) => {
      if (!current) return;
      setContacts((a.items || []) as Contact[]); setCompanies((b.items || []) as Company[]);
      setTasks((c.items || []) as Task[]); setStages((d.items || []) as Stage[]);
      setAudits((e.items || []) as Audit[]);
    }).catch(cause => { if (current) setError(cause instanceof Error ? cause.message : "Could not load records."); });
    return () => { current = false; };
  }, [tenantId]);

  async function refresh(resource: string) {
    if (!tenantId) return;
    const result = await crm(resource, "GET", tenantId);
    if (resource === "contacts") setContacts((result.items || []) as Contact[]);
    if (resource === "companies") setCompanies((result.items || []) as Company[]);
    if (resource === "tasks") setTasks((result.items || []) as Task[]);
    const audit = await crm("audit", "GET", tenantId);
    setAudits((audit.items || []) as Audit[]);
  }
  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      await crm("organizations", "POST", undefined, { name: data.get("name"), legal_name: data.get("legal_name"), primary_domain: data.get("primary_domain"), timezone: data.get("timezone") });
      await loadOrganizations(); setMessage("Company workspace created.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create workspace."); }
    finally { setSaving(false); }
  }
  async function createRecord(event: FormEvent<HTMLFormElement>, resource: "contacts" | "companies" | "tasks") {
    event.preventDefault(); if (!tenantId) return;
    setSaving(true); setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    for (const key of Object.keys(data)) if (data[key] === "") delete data[key];
    try {
      await crm(resource, "POST", tenantId, { ...data, tenant_id: tenantId });
      await refresh(resource); setFormOpen(false); setMessage(`${resource === "companies" ? "Company" : resource === "contacts" ? "Contact" : "Task"} saved.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the record."); }
    finally { setSaving(false); }
  }
  async function updateOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!tenantId) return;
    setSaving(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      await crm("organizations", "PATCH", undefined, { tenant_id: tenantId, name: data.get("name"), legal_name: data.get("legal_name"), primary_domain: data.get("primary_domain"), timezone: data.get("timezone") });
      await loadOrganizations(); await refresh("contacts"); setMessage("Company information saved. DNS was not changed.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save company information."); }
    finally { setSaving(false); }
  }

  return <div className="nc-app">
    <header className="nc-top"><div className="nc-brand"><span>N</span>NectCon</div><div className="nc-top-label">CRM foundation</div><a href="/workspace.html">Sales experience preview</a></header>
    <div className="nc-frame">
      <aside className="nc-side"><small>WORKSPACE</small><strong>{organization?.name || "Your company"}</strong><nav aria-label="CRM views">{tabs.map(item => <button key={item} type="button" className={tab===item?"active":""} onClick={()=>{setTab(item);setFormOpen(false);setMessage("");}}>{item}</button>)}</nav><p>Private pilot workspace. Calling, SMS, and email are off.</p></aside>
      <main className="nc-main">
        {loading ? <div className="nc-card">Loading your workspace…</div> : null}
        {needsSignIn ? <div className="nc-card"><h1>Sign in to continue</h1><p>Use your authorized account to open this workspace.</p><a className="nc-primary" href="/signin-with-chatgpt?return_to=%2Ffoundation" target="_top">Sign in</a></div> : null}
        {error ? <div className="nc-alert" role="alert">{error}</div> : null}
        {message ? <div className="nc-success" role="status">{message}</div> : null}
        {!loading && !needsSignIn && !tenantId ? <section className="nc-card nc-onboard"><small>FIRST STEP</small><h1>Create your company workspace</h1><p>Start with the company that will own the CRM records. Domain information is saved for later verification; this step does not change DNS or send messages.</p><form onSubmit={createOrganization} className="nc-form"><label>Company name<input name="name" required maxLength={160} placeholder="Your company" /></label><label>Legal business name<input name="legal_name" maxLength={160} /></label><label>Primary domain<input name="primary_domain" maxLength={253} placeholder="example.com" /></label><label>Timezone<input name="timezone" required defaultValue="America/Chicago" /></label><button className="nc-primary" disabled={saving}>Create workspace</button></form></section> : null}
        {tenantId && organization ? <>
          <div className="nc-heading"><div><span className="nc-eyebrow">{organization.name.toUpperCase()}</span><h1>{tab}</h1><p>{tab === "Organization" ? "Company information for future domain and provider setup" : "Records saved to your private workspace"}</p></div>{(["Contacts","Companies","Tasks"] as Tab[]).includes(tab) ? <button className="nc-primary" onClick={()=>setFormOpen(open=>!open)}>{formOpen?"Close form":`＋ New ${tab.slice(0,-1).toLowerCase()}`}</button> : null}</div>
          <div className="nc-org-switch"><label>Company workspace <select value={tenantId} onChange={event=>setTenantId(event.target.value)}>{organizations.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
          {formOpen && tab === "Contacts" ? <form className="nc-card nc-form" onSubmit={event=>createRecord(event,"contacts")}><h2>New contact</h2><div className="nc-fields"><label>Full name<input name="name" required maxLength={160}/></label><label>Company<select name="company_id"><option value="">None</option>{companies.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Email<input name="email" type="email" /></label><label>Phone<input name="phone" type="tel" /></label><label>Timezone<input name="timezone" placeholder="America/Chicago" /></label><label>Source<input name="source" /></label></div><p>Consent begins as unknown. Saving a contact never starts outreach.</p><button className="nc-primary" disabled={saving}>Save contact</button></form> : null}
          {formOpen && tab === "Companies" ? <form className="nc-card nc-form" onSubmit={event=>createRecord(event,"companies")}><h2>New company</h2><div className="nc-fields"><label>Company name<input name="name" required maxLength={160}/></label><label>Domain<input name="domain" placeholder="example.com" /></label></div><button className="nc-primary" disabled={saving}>Save company</button></form> : null}
          {formOpen && tab === "Tasks" ? <form className="nc-card nc-form" onSubmit={event=>createRecord(event,"tasks")}><h2>New task</h2><div className="nc-fields"><label>Task<input name="title" required maxLength={240}/></label><label>Contact<select name="contact_id"><option value="">None</option>{contacts.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Due date<input name="due_at" type="date" /></label></div><button className="nc-primary" disabled={saving}>Save task</button></form> : null}
          {tab === "Contacts" ? <div className="nc-card nc-list">{contacts.length ? contacts.map(item=><div className="nc-row" key={item.id}><span className="nc-avatar">{item.name.split(" ").map(x=>x[0]).slice(0,2).join("")}</span><div><strong>{item.name}</strong><small>{item.company_name || "No company"} · {item.email || "No email"}</small></div><span className="nc-tag">{item.lifecycle_stage}</span></div>) : <div className="nc-empty">No contacts yet. Add your first contact when you are ready.</div>}</div> : null}
          {tab === "Companies" ? <div className="nc-card nc-list">{companies.length ? companies.map(item=><div className="nc-row" key={item.id}><div><strong>{item.name}</strong><small>{item.domain || "No domain entered"}</small></div></div>) : <div className="nc-empty">No companies yet.</div>}</div> : null}
          {tab === "Tasks" ? <div className="nc-card nc-list">{tasks.length ? tasks.map(item=><div className="nc-row" key={item.id}><div><strong>{item.title}</strong><small>{item.due_at || "No due date"}</small></div><span className="nc-tag">{item.status}</span></div>) : <div className="nc-empty">No tasks yet.</div>}</div> : null}
          {tab === "Pipeline" ? <div className="nc-pipeline">{stages.map(item=><section className="nc-card" key={item.stage_id}><h2>{item.stage_name}</h2><p>No opportunities in this stage yet.</p></section>)}</div> : null}
          {tab === "Organization" ? <form className="nc-card nc-form nc-profile" onSubmit={updateOrganization}><h2>Company profile</h2><p>These details belong to this workspace. DNS changes and provider purchases require a separate authorization flow.</p><div className="nc-fields"><label>Company name<input name="name" defaultValue={organization.name} required maxLength={160}/></label><label>Legal business name<input name="legal_name" defaultValue={organization.legal_name || ""} maxLength={160}/></label><label>Primary domain<input name="primary_domain" defaultValue={organization.primary_domain || ""} maxLength={253}/></label><label>Timezone<input name="timezone" defaultValue={organization.timezone} required /></label></div><button className="nc-primary" disabled={saving}>Save company profile</button></form> : null}
          {tab === "Audit history" ? <div className="nc-card nc-list">{audits.length ? audits.map(item=><div className="nc-row" key={item.id}><div><strong>{item.kind.replace("."," · ")}</strong><small>{item.target_type} · {item.created_at}</small></div></div>) : <div className="nc-empty">No audit events yet.</div>}</div> : null}
        </> : null}
      </main>
    </div>
  </div>;
}
