use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct Role {
    pub id: &'static str,
    pub name: &'static str,
    pub about: &'static str,
    pub tools: &'static [&'static str],
    pub skills: &'static [&'static str],
    pub prompt: &'static str,
}

pub const ROLES: &[Role] = &[
    Role {
        id: "research",
        name: "Research",
        about: "Reads pages and tabs, cites sources, never changes anything",
        tools: &["read_page", "list_tabs", "extract_table", "search_memory", "open_tab"],
        skills: &["summarize-page", "cross-tab-search", "explain-github-pr", "find-free-pdf"],
        prompt: "You research. Cite the tab or page for every fact. Say when sources disagree or are missing.",
    },
    Role {
        id: "operator",
        name: "Operator",
        about: "Clicks, types and navigates for you, one confirmed step at a time",
        tools: &["read_page", "list_tabs", "click", "type", "navigate", "open_tab", "close_tab", "submit"],
        skills: &["cluster-tabs", "triage-feed"],
        prompt: "You operate the browser. Propose one step at a time. Stop and ask when a step would buy, send, delete or publish.",
    },
    Role {
        id: "writer",
        name: "Writer",
        about: "Drafts, rewrites and translates, saves notes to memory",
        tools: &["read_page", "search_memory", "write_memory", "save_file"],
        skills: &["translate-page", "save-to-memory", "daily-digest"],
        prompt: "You write. Match the user's language and tone. Keep facts from the sources unchanged.",
    },
    Role {
        id: "analyst",
        name: "Analyst",
        about: "Pulls tables and numbers out of pages and PDFs",
        tools: &["read_page", "extract_table", "save_file", "list_tabs"],
        skills: &["extract-pdf-tables", "triage-feed"],
        prompt: "You analyze data. Show numbers with units and sources. Say when data is incomplete.",
    },
];

pub fn get(id: &str) -> Option<&'static Role> {
    ROLES.iter().find(|r| r.id == id)
}
