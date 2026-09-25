import catalog from "../public/integration-scopes.json";

export const integrationScopeKeys = catalog.map(item => item.key);
export const integrationScopeSet = new Set(integrationScopeKeys);

const resourceScopes: Record<string, { read?: string[]; write?: string[] }> = {
  contacts: { read: ["contacts.readonly"], write: ["contacts.write"] },
  companies: { read: ["businesses.readonly"], write: ["businesses.write"] },
  pipelines: { read: ["opportunities.readonly"], write: ["opportunities.write"] },
  stages: { read: ["opportunities.readonly"], write: ["opportunities.write"] },
  opportunities: { read: ["opportunities.readonly"], write: ["opportunities.write"] },
  tasks: { read: ["contacts.readonly", "locations/tasks.readonly"], write: ["contacts.write"] },
  "automation-rules": { read: ["workflows.readonly"], write: ["nectcon.automations.write"] },
  documents: { read: ["documents_contracts/list.readonly"], write: ["documents_contracts/sendlink.write"] },
  "document-templates": { read: ["documents_contracts_templates/list.readonly"], write: ["documents_contracts_templates/sendlink.write"] },
  "document-send": { write: ["documents_contracts/sendlink.write"] },
  "template-send": { write: ["documents_contracts_templates/sendlink.write"] },
};

export function canUseResource(permissions: string[], resource: string, access: "read" | "write" | "delete") {
  const required = resourceScopes[resource]?.[access === "read" ? "read" : "write"] || [];
  return required.some(scope => permissions.includes(scope));
}

export const implementedScopes = new Set(Object.values(resourceScopes).flatMap(value => [...(value.read || []), ...(value.write || [])]));
