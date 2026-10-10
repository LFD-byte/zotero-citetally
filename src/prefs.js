/* eslint-disable no-undef */
pref("extensions.citecounts.openalex.enabled", true);
pref("extensions.citecounts.openalex.apiKey", "");
pref("extensions.citecounts.s2.enabled", true);
pref("extensions.citecounts.s2.apiKey", "");
// Optional contact e-mail sent to OpenAlex as `mailto` (polite usage)
pref("extensions.citecounts.email", "");
// Look up items without a DOI/arXiv ID by exact title match
pref("extensions.citecounts.titleFallback", true);
// Fetch counts automatically for newly added items
pref("extensions.citecounts.autoOnAdd", false);
// "Update outdated" refreshes counts older than this many days (string: bound to a text input)
pref("extensions.citecounts.staleDays", "30");
