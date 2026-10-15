//! What a log line on disk actually looks like, and where it lands.

use host_logging::{init, subscriber, LOG_FILE};
use serde_json::Value;

#[test]
fn a_log_line_is_one_json_object_carrying_its_fields() {
    let directory = tempfile::tempdir().expect("a temporary directory is available");
    let path = directory.path().join(LOG_FILE);
    let file = std::fs::File::create(&path).expect("the log file is created");

    tracing::subscriber::with_default(subscriber(file), || {
        tracing::info!(
            subtitle_language = "pt-BR",
            revision = 3,
            "the Host took an Action"
        );
    });

    let written = std::fs::read_to_string(&path).expect("the log file is readable");
    let line: Value = serde_json::from_str(written.trim()).expect("the line is JSON");
    assert_eq!(line["message"], "the Host took an Action");
    assert_eq!(line["level"], "INFO");
    assert_eq!(line["subtitle_language"], "pt-BR");
    assert_eq!(line["revision"], 3);
}

#[test]
fn the_host_logs_to_a_file_in_its_data_directory() {
    let directory = tempfile::tempdir().expect("a temporary directory is available");
    let data_dir = directory.path().join("data");

    let mut logs = init(&data_dir).expect("logging starts in a directory that does not exist yet");
    tracing::info!(version = "0.1.0", "the Host is starting");
    let path = logs.path().to_owned();
    logs.flush();
    drop(logs);

    assert_eq!(path, data_dir.join(LOG_FILE));
    let written = std::fs::read_to_string(&path).expect("the log file is on disk");
    let line: Value = serde_json::from_str(written.trim()).expect("the line is JSON");
    assert_eq!(line["message"], "the Host is starting");
}

#[test]
fn a_data_directory_that_cannot_be_created_is_reported_and_not_a_panic() {
    let directory = tempfile::tempdir().expect("a temporary directory is available");
    let blocked = directory.path().join("blocked");
    std::fs::write(&blocked, "not a directory")
        .expect("a file stands where the directory should be");

    let started = init(&blocked);

    assert!(
        matches!(started, Err(host_logging::LoggingError::Directory { .. })),
        "a data directory the Host cannot use is an error it reports: {:?}",
        started.err().map(|_| ())
    );
}
