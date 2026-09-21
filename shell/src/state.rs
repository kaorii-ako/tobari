#[derive(Debug, Clone)]
pub struct TabState {
    pub id: u64,
    pub url: String,
    pub title: String,
}

#[derive(Debug, Default)]
pub struct ShellState {
    pub tabs: Vec<TabState>,
    pub active: Option<u64>,
}

impl ShellState {
    pub fn open_tab(&mut self, url: String) -> u64 {
        let id = self.tabs.len() as u64 + 1;
        self.tabs.push(TabState { id, url, title: String::new() });
        self.active = Some(id);
        id
    }
}
