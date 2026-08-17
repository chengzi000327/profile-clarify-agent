function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toText(value, fallback = '') {
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function toLocation(value, fallback) {
  if (Array.isArray(value)) {
    const locations = value.map((item) => toText(item)).filter(Boolean);
    return locations.length > 0 ? locations.join(' / ') : fallback;
  }
  return toText(value, fallback);
}

function normalizeResponsibilities(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const items = value.map((item) => {
    if (typeof item === 'string') return item.trim();
    if (!isRecord(item)) return '';
    return toText(item.title ?? item.name ?? item.description);
  }).filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function normalizeCapabilities(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const items = value.map((item, index) => {
    if (typeof item === 'string') return { id: `capability-${index}`, title: item.trim(), description: '' };
    const capability = isRecord(item) ? item : {};
    return {
      id: toText(capability.id, `capability-${index}`),
      title: toText(capability.title ?? capability.name, `能力要求 ${index + 1}`),
      description: toText(capability.description ?? capability.evidence),
    };
  }).filter((item) => item.title);
  return items.length > 0 ? items : fallback;
}

export function normalizePublicJDContent(value, stateValue, fallbacks) {
  const content = isRecord(value) ? value : {};
  const state = isRecord(stateValue) ? stateValue : {};
  const hc = isRecord(state.hc_context) ? state.hc_context : {};
  const hcBasics = isRecord(hc.job_basics) ? hc.job_basics : {};
  const basics = isRecord(content.title_and_basics) ? content.title_and_basics : {};

  return {
    title: toText(basics.title ?? state.title, '岗位名称待同步'),
    department: toText(state.department, '团队待同步'),
    location: toLocation(basics.location ?? hcBasics.locations, '地点待同步'),
    employmentType: toText(basics.employment_type ?? hcBasics.employment_type, '全职'),
    level: toText(hcBasics.level, '职级待同步'),
    reportingLine: toText(basics.reporting_line ?? hcBasics.reporting_line, '待同步'),
    about: toText(content.about_the_role, fallbacks.about),
    responsibilities: normalizeResponsibilities(content.what_you_will_do, fallbacks.responsibilities),
    capabilities: normalizeCapabilities(content.what_we_look_for, fallbacks.capabilities),
  };
}
