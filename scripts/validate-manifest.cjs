// Validates manifest.yml with the same library `forge lint` uses, without needing to be logged in.
const { validate } = require('@forge/manifest');

validate(false).then((result) => {
  const errors = (result.errors || []).filter((e) => e.level === 'error');
  const warnings = (result.errors || []).filter((e) => e.level !== 'error');
  for (const e of result.errors || []) console.log(`${e.level}\t${e.reference || ''}\t${e.message}\t(line ${e.line})`);
  console.log(`manifest: ${result.success ? 'valid' : 'INVALID'} — ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(2); });
