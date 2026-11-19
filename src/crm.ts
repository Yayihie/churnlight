// CRM one-click pulls — same pattern as Stripe: the user pastes credentials,
// the server calls the CRM API and normalizes everything to Churnlight CSVs.
// Pure mappers are exported for tests; network functions stay thin.
// Credentials live only in the request; nothing is persisted.

// ---------- shared ----------

const isoDay = (d: string | undefined): string => (d || "").slice(0, 10);

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const csvRow = (vals: (string | number)[]) =>
  vals.map((v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",");

const daysBetween = (from: string, to: string): number =>
  Math.floor((new Date(to + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime()) / 86_400_000);

// ---------- HubSpot ----------

export interface HubSpotCompany { id: string; name: string; annualRevenue: number }
export interface HubSpotDeal { companyId: string; amount: number; closeDate: string }
export interface HubSpotTicket { companyId: string; subject: string; createdDate: string; state: string }

// accounts.csv from HubSpot: companies carry id/name/revenue; the earliest
// FUTURE deal close date becomes the renewal proxy (deals = committed money).
export function hubspotAccountsCsv(companies: HubSpotCompany[], deals: HubSpotDeal[], today = new Date().toISOString().slice(0, 10)): string {
  const nextClose = new Map<string, string>();
  for (const d of deals) {
    if (!d.companyId || !d.closeDate || d.closeDate < today) continue;
    const existing = nextClose.get(d.companyId);
    if (!existing || d.closeDate < existing) nextClose.set(d.companyId, d.closeDate);
  }
  const rows = ["id,name,mrr,renewal_on,last_contact_on"];
  for (const c of companies) {
    rows.push(csvRow([c.id, c.name, Math.round(c.annualRevenue / 12), nextClose.get(c.id) || "9999-12-31", "1970-01-01"]));
  }
  return rows.join("\n");
}

// tickets.csv: open tickets only; age = whole days since creation.
export function hubspotTicketsCsv(tickets: HubSpotTicket[], today: string): string {
  const rows = ["account_id,date,subject,status,age_days"];
  for (const t of tickets) {
    if (!t.companyId || !t.createdDate) continue;
    const resolved = t.state === "CLOSED" || t.state === "resolved";
    const age = Math.max(0, daysBetween(isoDay(t.createdDate), today));
    rows.push(csvRow([t.companyId, isoDay(t.createdDate), t.subject, resolved ? "resolved" : "open", age]));
  }
  return rows.join("\n");
}

// ---------- Salesforce ----------

export interface SfAccount { id: string; name: string; annualRevenue: number }
export interface SfCase { accountId: string; subject: string; createdDate: string; isClosed: boolean }

export function salesforceAccountsCsv(accounts: SfAccount[]): string {
  const rows = ["id,name,mrr,renewal_on,last_contact_on"];
  for (const a of accounts) {
    rows.push(csvRow([a.id, a.name, Math.round(a.annualRevenue / 12), "9999-12-31", "1970-01-01"]));
  }
  return rows.join("\n");
}

export function salesforceTicketsCsv(cases: SfCase[], today: string): string {
  const rows = ["account_id,date,subject,status,age_days"];
  for (const c of cases) {
    if (!c.accountId || !c.createdDate) continue;
    const age = Math.max(0, daysBetween(isoDay(c.createdDate), today));
    rows.push(csvRow([c.accountId, isoDay(c.createdDate), c.subject, c.isClosed ? "resolved" : "open", age]));
  }
  return rows.join("\n");
}

// ---------- network (thin; inject fetch for testability) ----------

export type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<any> }>;

async function hsPage(fetcher: FetchLike, token: string, path: string): Promise<any[]> {
  const out: any[] = [];
  let after = "";
  for (let page = 0; page < 10; page++) {
    const url = `https://api.hubapi.com${path}${path.includes("?") ? "&" : "?"}limit=100${after ? `&after=${after}` : ""}`;
    const res = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`HubSpot error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    out.push(...(data.results || []));
    after = data?.paging?.next?.after || "";
    if (!after) break;
  }
  return out;
}

export async function pullHubSpot(token: string, fetcher: FetchLike = fetch): Promise<{ "accounts.csv": string; "tickets.csv": string }> {
  const companies = (await hsPage(fetcher, token,
    "/crm/v3/objects/companies?properties=name,annual_revenue")).map((r) => ({
    id: r.id, name: r.properties?.name || "(unnamed)", annualRevenue: num(r.properties?.annual_revenue),
  }));
  // deals associated to companies: association ids are on the deal
  const dealsRaw = await hsPage(fetcher, token,
    "/crm/v3/objects/deals?properties=amount,closedate&associations=company");
  const deals: HubSpotDeal[] = dealsRaw.map((d) => ({
    companyId: d.associations?.results?.find((a: any) => a.toObjectType === "company")?.toObjectId
      ? String(d.associations.results.find((a: any) => a.toObjectType === "company").toObjectId) : "",
    amount: num(d.properties?.amount), closeDate: isoDay(d.properties?.closedate),
  })).filter((d) => d.companyId);
  const ticketsRaw = await hsPage(fetcher, token,
    "/crm/v3/objects/tickets?properties=subject,createdate,state&associations=company");
  const tickets: HubSpotTicket[] = ticketsRaw.map((t) => ({
    companyId: t.associations?.results?.find((a: any) => a.toObjectType === "company")?.toObjectId
      ? String(t.associations.results.find((a: any) => a.toObjectType === "company").toObjectId) : "",
    subject: t.properties?.subject || "(untitled)",
    createdDate: t.properties?.createdate || "",
    state: t.properties?.state || "",
  })).filter((t) => t.companyId);
  const today = new Date().toISOString().slice(0, 10);
  return { "accounts.csv": hubspotAccountsCsv(companies, deals), "tickets.csv": hubspotTicketsCsv(tickets, today) };
}

// Salesforce username-password flow (needs a connected app's key/secret +
// the user's security token). Returns the normalized CSVs.
export async function pullSalesforce(creds: {
  username: string; password: string; securityToken: string; clientId: string; clientSecret: string;
}, fetcher: FetchLike = fetch): Promise<{ "accounts.csv": string; "tickets.csv": string }> {
  const body = new URLSearchParams({
    grant_type: "password", client_id: creds.clientId, client_secret: creds.clientSecret,
    username: creds.username, password: creds.password + creds.securityToken,
  });
  const tokenRes = await fetcher("https://login.salesforce.com/services/oauth2/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
  });
  if (!tokenRes.ok) throw new Error(`Salesforce login error ${tokenRes.status}: ${(await tokenRes.text()).slice(0, 200)}`);
  const { access_token: at, instance_url: base } = await tokenRes.json();
  const soql = async (q: string) => {
    const res = await fetcher(`${base}/services/data/v59.0/query?q=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${at}` } });
    if (!res.ok) throw new Error(`Salesforce query error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()).records || [];
  };
  const accounts: SfAccount[] = (await soql("SELECT Id, Name, AnnualRevenue FROM Account")).map((r: any) => ({
    id: r.Id, name: r.Name || "(unnamed)", annualRevenue: num(r.AnnualRevenue),
  }));
  const cases: SfCase[] = (await soql("SELECT Id, AccountId, Subject, IsClosed, CreatedDate FROM Case")).map((r: any) => ({
    accountId: r.AccountId || "", subject: r.Subject || "(untitled)",
    createdDate: isoDay(r.CreatedDate), isClosed: !!r.IsClosed,
  }));
  const today = new Date().toISOString().slice(0, 10);
  return { "accounts.csv": salesforceAccountsCsv(accounts), "tickets.csv": salesforceTicketsCsv(cases, today) };
}
