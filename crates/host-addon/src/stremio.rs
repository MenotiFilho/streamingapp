//! The real HTTP client for Stremio's account service (#30).
//!
//! Stremio's API is JSON over POST, reached at `https://api.strem.io/api`.
//! This implements [`host_core::StremioApi`] using `ureq`, with the same
//! native TLS and platform certificates as [`crate::HttpFetcher`].

use host_core::{StremioApi, SyncError};
use serde_json::Value;

use crate::{default_agent, MAX_BODY_BYTES};

const DEFAULT_ENDPOINT: &str = "https://api.strem.io/api";

/// The real Stremio account client, over HTTP.
pub struct HttpStremio {
    agent: ureq::Agent,
    endpoint: String,
}

impl HttpStremio {
    pub fn new() -> Self {
        Self {
            agent: default_agent(),
            endpoint: DEFAULT_ENDPOINT.to_owned(),
        }
    }

    /// Point at a different endpoint, for tests.
    pub fn with_endpoint(mut self, endpoint: impl Into<String>) -> Self {
        self.endpoint = endpoint.into();
        self
    }

    fn post(&self, action: &str, body: &Value) -> Result<Value, SyncError> {
        let url = format!("{}/{}", self.endpoint.trim_end_matches('/'), action);
        let payload = serde_json::to_string(body).map_err(|error| SyncError::Malformed {
            detail: error.to_string(),
        })?;

        let response = self
            .agent
            .post(&url)
            .header("Content-Type", "application/json")
            .send(payload.as_str())
            .map_err(|error| match error {
                ureq::Error::StatusCode(code) => SyncError::Refused {
                    detail: format!("Stremio answered with status {code}"),
                },
                other => SyncError::Unreachable {
                    detail: other.to_string(),
                },
            })?;

        let text = response
            .into_body()
            .into_with_config()
            .limit(MAX_BODY_BYTES)
            .read_to_string()
            .map_err(|error| SyncError::Malformed {
                detail: error.to_string(),
            })?;

        let value: Value = serde_json::from_str(&text).map_err(|error| SyncError::Malformed {
            detail: error.to_string(),
        })?;

        if let Some(err) = value.get("error") {
            let message = err
                .get("message")
                .and_then(Value::as_str)
                .or_else(|| err.as_str())
                .unwrap_or("unknown error");
            return Err(SyncError::Refused {
                detail: message.to_owned(),
            });
        }

        Ok(value)
    }
}

impl Default for HttpStremio {
    fn default() -> Self {
        Self::new()
    }
}

impl StremioApi for HttpStremio {
    fn login(&self, email: &str, password: &str) -> Result<String, SyncError> {
        let body = serde_json::json!({
            "type": "Login",
            "email": email,
            "password": password,
            "facebook": false,
        });

        let value = self.post("login", &body)?;
        let key = value
            .get("result")
            .and_then(|res| res.get("authKey").or_else(|| res.get("key")))
            .or_else(|| value.get("authKey"))
            .and_then(Value::as_str)
            .ok_or_else(|| SyncError::Malformed {
                detail: "login response carries no authKey".to_owned(),
            })?;

        Ok(key.to_owned())
    }

    fn library(&self, auth_key: &str, ids: Option<&[String]>) -> Result<Vec<Value>, SyncError> {
        let body = match ids {
            Some(ids) => serde_json::json!({
                "authKey": auth_key,
                "collection": "libraryItem",
                "all": false,
                "ids": ids,
            }),
            None => serde_json::json!({
                "authKey": auth_key,
                "collection": "libraryItem",
                "all": true,
            }),
        };

        let value = self.post("datastoreGet", &body)?;
        let result = value.get("result").ok_or_else(|| SyncError::Malformed {
            detail: "datastoreGet response carries no result".to_owned(),
        })?;

        let items = result.as_array().ok_or_else(|| SyncError::Malformed {
            detail: "datastoreGet result is not an array".to_owned(),
        })?;

        Ok(items.clone())
    }

    fn put_library(&self, auth_key: &str, items: &[Value]) -> Result<(), SyncError> {
        let body = serde_json::json!({
            "authKey": auth_key,
            "collection": "libraryItem",
            "changes": items,
        });

        let _ = self.post("datastorePut", &body)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_stremio_defaults_to_stremio_api_url() {
        let client = HttpStremio::new();
        assert_eq!(client.endpoint, DEFAULT_ENDPOINT);
    }
}
