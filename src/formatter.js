/**
 * Formatter module.
 * Sole owner of markdown output format — consumes only RoleData objects.
 */

/**
 * Format a single role as a markdown entry matching the catalogue style.
 */
export function formatRole(role) {
  const lines = [];

  lines.push(`### ${role.title}`);
  lines.push(`**Company:** ${role.company}`);
  if (role.location) lines.push(`**Location:** ${role.location}`);
  if (role.salary) lines.push(`**Salary:** ${role.salary}`);
  if (role.team) lines.push(`**Team:** ${role.team}`);
  if (role.postedDate) lines.push(`**Posted:** ${formatDate(role.postedDate)}`);
  lines.push(`**Link:** [Apply](${role.url})`);

  if (role.requirements?.length > 0) {
    lines.push(`\n**Key Requirements:**`);
    for (const req of role.requirements.slice(0, 5)) {
      lines.push(`- ${req}`);
    }
  }

  if (role.description) {
    const summary = role.description.slice(0, 300).trim();
    lines.push(`\n> ${summary}${role.description.length > 300 ? '...' : ''}`);
  }

  return lines.join('\n');
}

/**
 * Format multiple roles into a markdown document.
 */
export function formatRoles(roles, options = {}) {
  const { title = 'Discovered Roles', groupByCompany = true } = options;
  const lines = [];

  lines.push(`# ${title}`);
  lines.push(`\nGenerated: ${new Date().toISOString()}`);
  lines.push(`Total roles: ${roles.length}\n`);

  if (groupByCompany) {
    const grouped = {};
    for (const role of roles) {
      const company = role.company || 'Unknown';
      if (!grouped[company]) grouped[company] = [];
      grouped[company].push(role);
    }

    for (const [company, companyRoles] of Object.entries(grouped).sort()) {
      lines.push(`\n## ${company} (${companyRoles.length} roles)\n`);
      for (const role of companyRoles) {
        lines.push(formatRole(role));
        lines.push('');
      }
    }
  } else {
    for (const role of roles) {
      lines.push(formatRole(role));
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Format enriched roles showing what was added.
 */
export function formatEnrichedRoles(enrichments) {
  const lines = [];

  lines.push(`# Enriched Roles Report`);
  lines.push(`\nGenerated: ${new Date().toISOString()}`);
  lines.push(`Total enriched: ${enrichments.length}\n`);

  for (const { original, enriched, fieldsAdded } of enrichments) {
    lines.push(`### ${enriched.title} — ${enriched.company}`);
    if (fieldsAdded.length > 0) {
      lines.push(`**New data:** ${fieldsAdded.join(', ')}`);
    }
    if (enriched.salary) lines.push(`**Salary:** ${enriched.salary}`);
    if (enriched.location) lines.push(`**Location:** ${enriched.location}`);
    if (enriched.team) lines.push(`**Team:** ${enriched.team}`);
    if (enriched.postedDate) lines.push(`**Posted:** ${formatDate(enriched.postedDate)}`);
    lines.push(`**Link:** [Apply](${enriched.url})`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatDate(dateStr) {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}
