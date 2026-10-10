citecounts-menu-update =
    .label = Update Citation Counts
citecounts-menu-update-stale =
    .label = Update Outdated Citation Counts
citecounts-menu-clear =
    .label = Remove Citation Counts
citecounts-menu-stop =
    .label = Stop Updating Citation Counts
citecounts-menu-collection =
    .label = Update Citation Counts
citecounts-menu-collection-stale =
    .label = Update Outdated Citation Counts

citecounts-undo-update =
    { $count ->
        [one] Update Citation Count
       *[other] Update Citation Counts
    }
citecounts-undo-clear =
    { $count ->
        [one] Remove Citation Count
       *[other] Remove Citation Counts
    }

citecounts-pref-sources = Sources
citecounts-pref-openalex-enable =
    .label = OpenAlex
citecounts-pref-openalex-key = API key:
citecounts-pref-openalex-key-help = Free at openalex.org → Settings → API. Without a key OpenAlex allows only a very small daily budget.
citecounts-pref-s2-enable =
    .label = Semantic Scholar
citecounts-pref-s2-key = API key (optional):
citecounts-pref-s2-key-help = Without a key requests are throttled to stay within the shared public rate limit.
citecounts-pref-email = Contact e-mail (optional, sent to OpenAlex):
citecounts-pref-behavior = Behavior
citecounts-pref-title-fallback =
    .label = Match items without DOI or arXiv ID by exact title
citecounts-pref-auto =
    .label = Fetch citation counts automatically for newly added items
citecounts-pref-stale = “Update outdated” refreshes counts older than (days):
citecounts-pref-storage = Counts are stored in the Extra field (e.g. “Citations (OpenAlex): 123 [2026-10-10]”) so they sync and export with your library. Show them as sortable columns by right-clicking the item list header.
