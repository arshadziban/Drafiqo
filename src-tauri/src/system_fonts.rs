use std::collections::BTreeSet;

/// The families of every font installed on this computer, sorted by name.
/// Scanning the font folders takes a moment, so it runs off the main thread.
#[tauri::command(async)]
pub fn list_system_fonts() -> Vec<String> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();
    let mut families = BTreeSet::new();
    for face in database.faces() {
        // The first name is the English one when the font has it.
        if let Some((name, _)) = face.families.first() {
            // A leading dot marks fonts the system keeps for itself.
            if !name.is_empty() && !name.starts_with('.') {
                families.insert(name.clone());
            }
        }
    }
    families.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::list_system_fonts;

    #[test]
    fn lists_installed_families_sorted_and_without_hidden_ones() {
        let families = list_system_fonts();
        assert!(!families.is_empty(), "every desktop has some fonts installed");
        assert!(families.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(families.iter().all(|name| !name.starts_with('.')));
    }
}
