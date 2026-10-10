//! Reading and writing `.drafiqo` project files.
//!
//! The frontend only ever passes paths the user picked in a native dialog (or
//! reopened from the recent list). These commands are the single place that
//! touches those files, and they refuse anything that is not a project file.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const EXTENSION: &str = "drafiqo";
/// Guards against loading something that is clearly not a project.
const MAX_PROJECT_BYTES: u64 = 512 * 1024 * 1024;

fn project_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("The project path must be absolute.".into());
    }
    let is_project = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case(EXTENSION));
    if !is_project {
        return Err(format!("Only .{EXTENSION} files can be opened or saved."));
    }
    Ok(path)
}

/// Writes `contents` to `path` without ever leaving a half-written file there:
/// the data goes to a temporary sibling, is flushed to disk, and is then
/// renamed over the destination in a single step.
pub fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| "The project path has no parent folder.".to_string())?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "The project path has no file name.".to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let temp = dir.join(format!(".{name}.{}-{stamp}.tmp", std::process::id()));

    let result = (|| -> std::io::Result<()> {
        let mut file = File::create(&temp)?;
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, path)
    })();

    if let Err(error) = result {
        let _ = fs::remove_file(&temp);
        return Err(format!("Could not save {}: {error}", path.display()));
    }
    Ok(())
}

#[tauri::command]
pub async fn save_project_file(path: String, contents: String) -> Result<(), String> {
    let path = project_path(&path)?;
    write_atomic(&path, contents.as_bytes())
}

#[tauri::command]
pub async fn load_project_file(path: String) -> Result<String, String> {
    let path = project_path(&path)?;
    let describe = |error: std::io::Error| format!("Could not open {}: {error}", path.display());
    let size = fs::metadata(&path).map_err(describe)?.len();
    if size > MAX_PROJECT_BYTES {
        return Err(format!("{} is too large to be a Drafiqo project.", path.display()));
    }
    fs::read_to_string(&path).map_err(describe)
}

/// Renames a project file in place. Refuses to move it to another folder or
/// to replace a file that already exists.
#[tauri::command]
pub async fn rename_project_file(from: String, to: String) -> Result<(), String> {
    let from = project_path(&from)?;
    let to = project_path(&to)?;
    rename_project(&from, &to)
}

fn rename_project(from: &Path, to: &Path) -> Result<(), String> {
    if from.parent() != to.parent() {
        return Err("A project can only be renamed within its own folder.".into());
    }
    let same_file = from.to_string_lossy().to_lowercase() == to.to_string_lossy().to_lowercase();
    // A change of letter case only is the same file on case-insensitive disks.
    if to.exists() && !same_file {
        let name = to.file_name().and_then(|n| n.to_str()).unwrap_or("that name");
        return Err(format!("A project named {name} already exists in this folder."));
    }
    fs::rename(from, to).map_err(|error| format!("Could not rename {}: {error}", from.display()))
}

const EXPORT_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "svg", "pdf"];

fn export_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("The export path must be absolute.".into());
    }
    let allowed = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| EXPORT_EXTENSIONS.iter().any(|x| e.eq_ignore_ascii_case(x)));
    if !allowed {
        return Err("Exports can only be written as PNG, JPG, WebP, SVG or PDF files.".into());
    }
    Ok(path)
}

/// Decodes the percent-encoding used to carry a path in a request header.
fn percent_decode(input: &str) -> Result<String, String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = input.get(i + 1..i + 3).ok_or("The export path is malformed.")?;
            out.push(u8::from_str_radix(hex, 16).map_err(|_| "The export path is malformed.")?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "The export path is not valid text.".to_string())
}

/// Returned when the destination exists and overwriting was not confirmed.
pub const EXISTS: &str = "EXISTS";

/// Writes an exported file. The bytes arrive as the raw request body, and the
/// destination (chosen by the user in a folder dialog) in request headers.
#[tauri::command]
pub fn write_export_file(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok());
    let path = export_path(&percent_decode(header("x-export-path").ok_or("No export path was given.")?)?)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("The export data was not sent as bytes.".into());
    };
    if path.exists() && header("x-export-overwrite") != Some("1") {
        return Err(EXISTS.into());
    }
    write_atomic(&path, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("drafiqo-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rejects_paths_that_are_not_projects() {
        assert!(project_path("/tmp/design.drafiqo").is_ok());
        assert!(project_path("/tmp/design.DRAFIQO").is_ok());
        assert!(project_path("/tmp/design.json").is_err());
        assert!(project_path("/etc/passwd").is_err());
        assert!(project_path("relative.drafiqo").is_err());
    }

    #[test]
    fn renames_within_the_folder_without_replacing_other_projects() {
        let dir = scratch_dir("rename");
        let a = dir.join("a.drafiqo");
        let b = dir.join("b.drafiqo");
        let c = dir.join("c.drafiqo");
        write_atomic(&a, b"one").unwrap();
        write_atomic(&b, b"two").unwrap();
        assert!(rename_project(&a, &b).unwrap_err().contains("already exists"));
        assert!(rename_project(&a, &dir.join("sub").join("c.drafiqo")).is_err());
        rename_project(&a, &c).unwrap();
        assert!(!a.exists());
        assert_eq!(fs::read_to_string(&c).unwrap(), "one");
        assert_eq!(fs::read_to_string(&b).unwrap(), "two");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn export_paths_are_limited_to_export_formats() {
        assert!(export_path("/tmp/Frame 1@2x.png").is_ok());
        assert!(export_path("/tmp/a.PDF").is_ok());
        assert!(export_path("/tmp/a.drafiqo").is_err());
        assert!(export_path("/tmp/a.sh").is_err());
        assert!(export_path("a.png").is_err());
    }

    #[test]
    fn decodes_header_paths() {
        assert_eq!(percent_decode("%2FUsers%2Fa%20b%2F%C3%A9.png").unwrap(), "/Users/a b/é.png");
        assert!(percent_decode("%2").is_err());
        assert!(percent_decode("%zz").is_err());
    }

    #[test]
    fn atomic_write_replaces_contents_and_leaves_no_temp_files() {
        let dir = scratch_dir("atomic");
        let path = dir.join("design.drafiqo");
        write_atomic(&path, b"first").unwrap();
        write_atomic(&path, b"second").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "second");
        let names: Vec<_> = fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names.len(), 1, "unexpected leftovers: {names:?}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn failed_write_keeps_the_previous_file() {
        let dir = scratch_dir("failed");
        let path = dir.join("missing-folder").join("design.drafiqo");
        assert!(write_atomic(&path, b"data").is_err());
        assert!(!path.exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
