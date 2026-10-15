//! An Addon's manifest, in the Host's own words, and the parse that produces it.
//!
//! The manifest is third-party input, so the parse is a pure decision that judges
//! it before anything is stored or published: a body that is not JSON, a required
//! field that is missing or of the wrong type, a list or a string longer than the
//! Host will hold — each is a typed refusal rather than a panic, and a refusal
//! leaves nothing behind.
//!
//! The manifest URL is deliberately *not* part of [`Manifest`]: for an Addon like
//! AIOStreams that URL carries the debrid configuration, so it is the one field a
//! [`crate::Snapshot`] must never carry (see ADR-0009).

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use url::Url;

use crate::request::{Extra, ResourceRequest, CATALOG, SEARCH};

/// The longest a manifest body may be before it is refused rather than parsed.
pub const MAX_MANIFEST_BYTES: usize = 1024 * 1024;

/// The most items any list in a manifest may carry.
pub const MAX_ITEMS: usize = 1024;

/// The longest any string in a manifest may be.
pub const MAX_STRING_LEN: usize = 4096;

/// The longest a manifest URL may be.
pub const MAX_URL_LEN: usize = 2048;

/// Where an Addon's manifest lives.
///
/// Held as the text the owner pasted, judged only well enough to know the Host can
/// fetch it: an absolute `http`/`https` URL with a host. It is a credential by
/// presumption — the Addon's configuration rides inside it — so it is stored and
/// fetched and never published.
///
/// Deserialization goes back through [`ManifestUrl::parse`], so a value of this
/// type is always one the Host judged, however it arrived.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ManifestUrl(String);

impl ManifestUrl {
    /// Parse a manifest URL, or say why this string is not one.
    pub fn parse(raw: &str) -> Result<Self, InvalidManifestUrl> {
        let invalid = || InvalidManifestUrl {
            url: raw.to_owned(),
        };

        if raw.is_empty() || raw.len() > MAX_URL_LEN {
            return Err(invalid());
        }
        let url = Url::parse(raw).map_err(|_| invalid())?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(invalid());
        }
        if url.host_str().is_none_or(str::is_empty) {
            return Err(invalid());
        }

        Ok(Self(raw.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for ManifestUrl {
    type Error = InvalidManifestUrl;

    fn try_from(raw: String) -> Result<Self, Self::Error> {
        Self::parse(&raw)
    }
}

impl From<ManifestUrl> for String {
    fn from(url: ManifestUrl) -> Self {
        url.0
    }
}

impl std::fmt::Display for ManifestUrl {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// A string that is not a manifest URL, offered as one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{url:?} is not a manifest URL — it should be an http or https address")]
pub struct InvalidManifestUrl {
    pub url: String,
}

/// The id an Addon gives itself.
///
/// This is the Addon's identity for everything above the store: the manifest id,
/// which is what a client names when it removes one (ADR-0009). Deserialization
/// goes back through [`AddonId::parse`] for the same reason a manifest URL does.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct AddonId(String);

impl AddonId {
    /// The longest id the Host will hold.
    const MAX_LEN: usize = 128;

    /// Parse an Addon id, or say why this string is not one.
    pub fn parse(raw: &str) -> Result<Self, InvalidAddonId> {
        let invalid = || InvalidAddonId { id: raw.to_owned() };

        if raw.is_empty() || raw.len() > Self::MAX_LEN {
            return Err(invalid());
        }
        if raw.chars().any(|c| c.is_control() || c.is_whitespace()) {
            return Err(invalid());
        }

        Ok(Self(raw.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for AddonId {
    type Error = InvalidAddonId;

    fn try_from(raw: String) -> Result<Self, Self::Error> {
        Self::parse(&raw)
    }
}

impl From<AddonId> for String {
    fn from(id: AddonId) -> Self {
        id.0
    }
}

impl std::fmt::Display for AddonId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// A string that is not an Addon id, offered as one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{id:?} is not an Addon id")]
pub struct InvalidAddonId {
    pub id: String,
}

/// A manifest, parsed into the Host's vocabulary.
///
/// Only what the Host needs to show and to ask for later: who the Addon is, and
/// what it says it offers. Fields the protocol allows but this Host has no use for
/// yet — `description`, `logo`, `background`, `addonCatalogs`, the SDK's cache
/// hints — are ignored rather than refused, so an Addon that knows more than this
/// Host does still works.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: AddonId,
    pub name: String,
    pub version: String,
    pub resources: Vec<Resource>,
    pub types: Vec<String>,
    pub catalogs: Vec<Catalog>,
    pub id_prefixes: Vec<String>,
    pub behavior_hints: BehaviorHints,
}

/// One resource an Addon provides, and how far it reaches.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    /// The resource's name: `catalog`, `meta`, `stream`, `subtitles`, and whatever
    /// the protocol grows next.
    pub name: String,
    /// The types this resource covers, or `null` for every type the manifest lists.
    pub types: Option<Vec<String>>,
    /// The id prefixes this resource answers for, or `null` for all of them.
    pub id_prefixes: Option<Vec<String>>,
}

/// A catalog an Addon offers, and the controls it takes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    #[serde(rename = "type")]
    pub r#type: String,
    pub id: String,
    pub name: String,
    /// The `extra` parameters this catalog takes: `search`, `skip`, `genre`,
    /// `date`, and whatever else the Addon declares. `#[serde(default)]` because
    /// they arrived after the first Addons were stored (ADR-0009).
    #[serde(default)]
    pub extra: Vec<ExtraProp>,
}

/// One control a catalog takes, and how far it reaches.
///
/// The protocol also declares `optionsLimit` — how many values of this property
/// one request may carry. It is not read, for the same reason the protocol's
/// other fields this Host has no use for are not read (ADR-0009): nothing here
/// builds a request carrying several values for one property yet, and reading a
/// field nothing acts on is a promise this Host would not be keeping.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExtraProp {
    /// The name this property goes by in a request: `search`, `skip`, `genre`.
    pub name: String,
    /// Set when the catalog is only ever asked with this value — Stremio's
    /// `isRequired`, which is required of any client, not only of Stremio.
    pub is_required: bool,
    /// The values the Addon offers, when it offers a fixed list — genres,
    /// decades, sort orders.
    pub options: Vec<String>,
}

impl ExtraProp {
    /// A property with nothing declared but its name.
    pub fn named(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            ..Self::default()
        }
    }

    /// The same, required of every request.
    pub fn required(mut self) -> Self {
        self.is_required = true;
        self
    }

    /// The same, offering these values to choose from.
    pub fn offering(mut self, options: &[&str]) -> Self {
        self.options = options.iter().map(|option| (*option).to_owned()).collect();
        self
    }
}

impl Catalog {
    /// Whether this catalog takes exactly these chosen values and no less:
    /// every value chosen is one it offers, and every value it requires was
    /// chosen — the protocol's own rule, as Stremio's client applies it.
    pub fn takes_extra(&self, chosen: &[Extra]) -> bool {
        let offered = chosen
            .iter()
            .all(|chosen| self.extra.iter().any(|prop| prop.name == chosen.name));
        let required = self
            .extra
            .iter()
            .filter(|prop| prop.is_required)
            .all(|prop| chosen.iter().any(|chosen| chosen.name == prop.name));

        offered && required
    }

    /// These chosen values, with the ones this catalog requires and the client
    /// left out filled in from the first value the catalog offers.
    ///
    /// The Host is the client of the addon protocol (ADR-0006), so the rule that
    /// a required value has to be sent is the Host's to satisfy: a window should
    /// not have to know that Cinemeta's `New` catalog needs `genre=2026` before
    /// it can draw the row. A required value the catalog offers nothing to
    /// choose for is left out, and the catalog then does not take the request —
    /// [`takes_extra`](Self::takes_extra) says so and the Host says why.
    pub fn with_defaults(&self, mut chosen: Vec<Extra>) -> Vec<Extra> {
        for default in self.default_extra().unwrap_or_default() {
            if !chosen.iter().any(|held| held.name == default.name) {
                chosen.push(default);
            }
        }
        chosen
    }

    /// What to ask this catalog for when the client chose nothing: the first
    /// value offered for each property the catalog requires.
    ///
    /// `None` when a required property offers nothing to choose — such a catalog
    /// cannot be asked for on its own at all.
    pub fn default_extra(&self) -> Option<Vec<Extra>> {
        self.required_defaults()
    }

    /// What to ask this catalog to search for `query`, or `None` when it offers
    /// no search: the query, plus the first value of every other property it
    /// requires.
    pub fn search_extra(&self, query: &str) -> Option<Vec<Extra>> {
        if !self.extra.iter().any(|prop| prop.name == SEARCH) {
            return None;
        }

        // The query is this property's value, so it is not one that has to be
        // defaulted — but every *other* required property still does have to be
        // satisfied, and if one of them offers nothing to choose there is no
        // search to make.
        let mut extra = self
            .extra
            .iter()
            .filter(|prop| prop.is_required && prop.name != SEARCH)
            .map(|prop| {
                prop.options
                    .first()
                    .map(|first| Extra::of(prop.name.as_str(), first.as_str()))
            })
            .collect::<Option<Vec<Extra>>>()?;
        extra.push(Extra::of(SEARCH, query));
        Some(extra)
    }

    fn required_defaults(&self) -> Option<Vec<Extra>> {
        self.extra
            .iter()
            .filter(|prop| prop.is_required)
            .map(|prop| {
                prop.options
                    .first()
                    .map(|first| Extra::of(prop.name.as_str(), first.as_str()))
            })
            .collect()
    }
}

/// What an Addon says about how it is to be configured.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BehaviorHints {
    pub configurable: bool,
    pub configuration_required: bool,
}

/// An Addon the Host is configured with: where its manifest lives, and the
/// manifest itself.
///
/// The two travel together, and only the second one is ever published.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Addon {
    manifest_url: ManifestUrl,
    manifest: Manifest,
}

impl Addon {
    pub fn new(manifest_url: ManifestUrl, manifest: Manifest) -> Self {
        Self {
            manifest_url,
            manifest,
        }
    }

    pub fn manifest_url(&self) -> &ManifestUrl {
        &self.manifest_url
    }

    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    pub fn id(&self) -> &AddonId {
        &self.manifest.id
    }
}

/// Why a manifest was not read, in the Host's own vocabulary.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ManifestError {
    #[error("that is not a manifest: {detail}")]
    NotJson { detail: String },
    #[error("the manifest is missing {field}")]
    Missing { field: String },
    #[error("{field} should be {expected}")]
    WrongType {
        field: String,
        expected: &'static str,
    },
    #[error("{field} is longer than this Host will hold ({limit})")]
    TooLarge { field: String, limit: usize },
    #[error("{field} is not usable: {detail}")]
    Invalid { field: String, detail: String },
}

impl Manifest {
    /// Parse a manifest body into the Host's vocabulary.
    ///
    /// Pure: no I/O, no state, and a refusal is just a value.
    pub fn parse(body: &str) -> Result<Self, ManifestError> {
        if body.len() > MAX_MANIFEST_BYTES {
            return Err(ManifestError::TooLarge {
                field: "the manifest".to_owned(),
                limit: MAX_MANIFEST_BYTES,
            });
        }

        let value: Value = serde_json::from_str(body).map_err(|error| ManifestError::NotJson {
            detail: error.to_string(),
        })?;
        let object = value.as_object().ok_or_else(|| ManifestError::NotJson {
            detail: "a manifest is a JSON object".to_owned(),
        })?;

        let id = match AddonId::parse(&required_string(object, "id")?) {
            Ok(id) => id,
            Err(error) => {
                return Err(ManifestError::Invalid {
                    field: "id".to_owned(),
                    detail: error.to_string(),
                })
            }
        };

        Ok(Self {
            id,
            name: required_string(object, "name")?,
            version: required_string(object, "version")?,
            resources: resources(required(object, "resources")?)?,
            types: string_array(required(object, "types")?, "types")?,
            catalogs: catalogs(object)?,
            id_prefixes: match optional(object, "idPrefixes") {
                None => Vec::new(),
                Some(value) => string_array(value, "idPrefixes")?,
            },
            behavior_hints: behavior_hints(object)?,
        })
    }

    /// The catalog this Addon declared with this type and id, if it declared
    /// one. A catalog is reached through its own id, so both are needed and
    /// neither is enough.
    pub fn catalog(&self, r#type: &str, id: &str) -> Option<&Catalog> {
        self.catalogs
            .iter()
            .find(|catalog| catalog.r#type == r#type && catalog.id == id)
    }

    /// Whether this Addon answers for this request.
    ///
    /// `catalog` is the special case the protocol asks about by name: an Addon is
    /// asked for the catalogs it declares and only those, with the extras it
    /// declared — the protocol's own note is that `idPrefixes` does not apply to
    /// catalogs, since a catalog is reached through its id, not through a Title's.
    ///
    /// Every other resource is judged by the types it covers and the id prefixes
    /// it reaches: a resource that declares no types reaches the manifest's own,
    /// and one that declares no prefixes reaches every id. That is what keeps an
    /// Addon from being asked about ids that are not its business, and it is the
    /// rule #24 and #26 ask `meta` and `stream` with (ADR-0006, ADR-0010).
    pub fn answers(&self, request: &ResourceRequest) -> bool {
        if request.resource == CATALOG {
            return self
                .catalog(&request.r#type, &request.id)
                .is_some_and(|catalog| catalog.takes_extra(&request.extra));
        }

        let Some(resource) = self
            .resources
            .iter()
            .find(|resource| resource.name == request.resource)
        else {
            return false;
        };

        let types = resource.types.as_ref().unwrap_or(&self.types);
        let type_supported = types.iter().any(|r#type| r#type == &request.r#type);
        let id_supported = match &resource.id_prefixes {
            None => true,
            Some(prefixes) => {
                prefixes.is_empty()
                    || prefixes
                        .iter()
                        .any(|prefix| request.id.starts_with(prefix.as_str()))
            }
        };

        type_supported && id_supported
    }
}

/// The field of a path to look up: `resources[0].name` is the `name` of a
/// resource, and `types` is itself.
///
/// Every helper below takes a path rather than a field name, so that what it
/// reports when something is wrong names where the something is — `catalogs[0].id`
/// rather than a bare `id` that could be any of a dozen.
fn leaf(path: &str) -> &str {
    path.rsplit('.').next().unwrap_or(path)
}

/// A list, and the two ways a manifest's list can be unacceptable before anything
/// is read out of it: it is not a list, or it is longer than the Host will hold.
fn items<'a>(
    value: &'a Value,
    path: &str,
    expected: &'static str,
) -> Result<&'a [Value], ManifestError> {
    let items = value.as_array().ok_or_else(|| ManifestError::WrongType {
        field: path.to_owned(),
        expected,
    })?;
    if items.len() > MAX_ITEMS {
        return Err(ManifestError::TooLarge {
            field: path.to_owned(),
            limit: MAX_ITEMS,
        });
    }
    Ok(items)
}

/// A field that must be there.
fn required<'a>(object: &'a Map<String, Value>, path: &str) -> Result<&'a Value, ManifestError> {
    object
        .get(leaf(path))
        .ok_or_else(|| ManifestError::Missing {
            field: path.to_owned(),
        })
}

/// A field that may be absent, or `null` for absent.
fn optional<'a>(object: &'a Map<String, Value>, path: &str) -> Option<&'a Value> {
    match object.get(leaf(path)) {
        None | Some(Value::Null) => None,
        Some(value) => Some(value),
    }
}

/// A field that must be there, must be a string, and must not be empty.
fn required_string(object: &Map<String, Value>, path: &str) -> Result<String, ManifestError> {
    let text = string(required(object, path)?, path)?;
    if text.is_empty() {
        return Err(ManifestError::Invalid {
            field: path.to_owned(),
            detail: "it is empty".to_owned(),
        });
    }
    Ok(text)
}

/// A field that may be absent, or `null` for absent.
fn optional_string(
    object: &Map<String, Value>,
    path: &str,
) -> Result<Option<String>, ManifestError> {
    match optional(object, path) {
        None => Ok(None),
        Some(value) => Ok(Some(string(value, path)?)),
    }
}

fn string(value: &Value, path: &str) -> Result<String, ManifestError> {
    let text = value.as_str().ok_or_else(|| ManifestError::WrongType {
        field: path.to_owned(),
        expected: "a string",
    })?;
    if text.len() > MAX_STRING_LEN {
        return Err(ManifestError::TooLarge {
            field: path.to_owned(),
            limit: MAX_STRING_LEN,
        });
    }
    Ok(text.to_owned())
}

fn string_array(value: &Value, path: &str) -> Result<Vec<String>, ManifestError> {
    items(value, path, "an array of strings")?
        .iter()
        .enumerate()
        .map(|(index, item)| string(item, &format!("{path}[{index}]")))
        .collect()
}

/// An array of strings that may be absent, or `null` for absent.
fn optional_string_array(
    object: &Map<String, Value>,
    path: &str,
) -> Result<Option<Vec<String>>, ManifestError> {
    match optional(object, path) {
        None => Ok(None),
        Some(value) => Ok(Some(string_array(value, path)?)),
    }
}

/// `resources` is the one list in a manifest whose items are two shapes: a bare
/// name, or a name with the types and id prefixes it reaches.
fn resources(value: &Value) -> Result<Vec<Resource>, ManifestError> {
    items(value, "resources", "an array")?
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let path = format!("resources[{index}]");
            match item {
                Value::String(name) => Ok(Resource {
                    name: name.clone(),
                    types: None,
                    id_prefixes: None,
                }),
                Value::Object(object) => Ok(Resource {
                    name: required_string(object, &format!("{path}.name"))?,
                    types: optional_string_array(object, &format!("{path}.types"))?,
                    id_prefixes: optional_string_array(object, &format!("{path}.idPrefixes"))?,
                }),
                _ => Err(ManifestError::WrongType {
                    field: path,
                    expected: "a resource name, or an object describing one",
                }),
            }
        })
        .collect()
}

fn catalogs(object: &Map<String, Value>) -> Result<Vec<Catalog>, ManifestError> {
    let Some(value) = optional(object, "catalogs") else {
        return Ok(Vec::new());
    };

    items(value, "catalogs", "an array")?
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let path = format!("catalogs[{index}]");
            let catalog = item.as_object().ok_or_else(|| ManifestError::WrongType {
                field: path.clone(),
                expected: "an object",
            })?;

            let id = required_string(catalog, &format!("{path}.id"))?;
            Ok(Catalog {
                r#type: required_string(catalog, &format!("{path}.type"))?,
                name: match optional_string(catalog, &format!("{path}.name"))? {
                    Some(name) if !name.is_empty() => name,
                    // The protocol treats a catalog's name as optional; the id is
                    // the least surprising thing to show in its place.
                    _ => id.clone(),
                },
                extra: catalog_extras(catalog, &path)?,
                id,
            })
        })
        .collect()
}

/// The controls a catalog takes.
///
/// The protocol has two ways of saying it: the long form (`extra`, an array of
/// `{ name, isRequired, options, optionsLimit }`) and the short one
/// (`extraSupported` / `extraRequired`, arrays of names). Addons in the wild
/// send one or the other, and Cinemeta sends both — the long form wins when it
/// is there, because it is the one that carries the options.
fn catalog_extras(
    catalog: &Map<String, Value>,
    path: &str,
) -> Result<Vec<ExtraProp>, ManifestError> {
    if let Some(value) = optional(catalog, &format!("{path}.extra")) {
        return items(value, &format!("{path}.extra"), "an array")?
            .iter()
            .enumerate()
            .map(|(index, item)| extra_prop(item, &format!("{path}.extra[{index}]")))
            .collect();
    }

    let Some(supported) = optional_string_array(catalog, &format!("{path}.extraSupported"))? else {
        return Ok(Vec::new());
    };
    let required =
        optional_string_array(catalog, &format!("{path}.extraRequired"))?.unwrap_or_default();

    Ok(supported
        .into_iter()
        .map(|name| {
            let prop = ExtraProp::named(name);
            if required.contains(&prop.name) {
                prop.required()
            } else {
                prop
            }
        })
        .collect())
}

/// One declared control: a name, and optionally whether it is required and what
/// it offers. A property of a shape this Host cannot read is a lie about the
/// manifest, so it is named like every other one.
fn extra_prop(value: &Value, path: &str) -> Result<ExtraProp, ManifestError> {
    let prop = value.as_object().ok_or_else(|| ManifestError::WrongType {
        field: path.to_owned(),
        expected: "an object describing an extra",
    })?;

    Ok(ExtraProp {
        name: required_string(prop, &format!("{path}.name"))?,
        is_required: optional_bool(prop, &format!("{path}.isRequired"))?,
        options: match optional(prop, &format!("{path}.options")) {
            None => Vec::new(),
            Some(value) => string_array(value, &format!("{path}.options"))?,
        },
    })
}

fn behavior_hints(object: &Map<String, Value>) -> Result<BehaviorHints, ManifestError> {
    let Some(value) = optional(object, "behaviorHints") else {
        return Ok(BehaviorHints::default());
    };
    let hints = value.as_object().ok_or_else(|| ManifestError::WrongType {
        field: "behaviorHints".to_owned(),
        expected: "an object",
    })?;

    Ok(BehaviorHints {
        configurable: optional_bool(hints, "behaviorHints.configurable")?,
        configuration_required: optional_bool(hints, "behaviorHints.configurationRequired")?,
    })
}

fn optional_bool(object: &Map<String, Value>, path: &str) -> Result<bool, ManifestError> {
    match optional(object, path) {
        None => Ok(false),
        Some(value) => value.as_bool().ok_or_else(|| ManifestError::WrongType {
            field: path.to_owned(),
            expected: "true or false",
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A manifest with everything the protocol requires and nothing else.
    fn minimal() -> String {
        serde_json::json!({
            "id": "org.example.addon",
            "name": "Example",
            "version": "1.2.3",
            "resources": ["catalog", "meta"],
            "types": ["movie", "series"],
            "catalogs": [],
        })
        .to_string()
    }

    fn parsed(body: &str) -> Manifest {
        Manifest::parse(body).unwrap_or_else(|error| panic!("{body} should parse: {error}"))
    }

    fn refused(body: &str) -> ManifestError {
        match Manifest::parse(body) {
            Ok(manifest) => panic!("{body} should be refused, but parsed as {manifest:?}"),
            Err(error) => error,
        }
    }

    #[test]
    fn a_manifest_is_parsed_into_the_hosts_own_vocabulary() {
        let manifest = parsed(&minimal());

        assert_eq!(manifest.id.as_str(), "org.example.addon");
        assert_eq!(manifest.name, "Example");
        assert_eq!(manifest.version, "1.2.3");
        assert_eq!(
            manifest.resources,
            vec![
                Resource {
                    name: "catalog".to_owned(),
                    types: None,
                    id_prefixes: None,
                },
                Resource {
                    name: "meta".to_owned(),
                    types: None,
                    id_prefixes: None,
                },
            ]
        );
        assert_eq!(manifest.types, vec!["movie", "series"]);
        assert_eq!(manifest.catalogs, Vec::<Catalog>::new());
        assert_eq!(manifest.id_prefixes, Vec::<String>::new());
        assert!(!manifest.behavior_hints.configurable);
    }

    #[test]
    fn a_resource_can_describe_the_types_and_prefixes_it_reaches() {
        let manifest = parsed(
            r#"{
                "id": "org.example.addon",
                "name": "Example",
                "version": "1.0.0",
                "resources": [
                    "catalog",
                    { "name": "meta", "types": ["movie"], "idPrefixes": ["tt", "tmdb"] },
                    { "name": "stream", "types": ["movie"] }
                ],
                "types": ["movie"],
                "catalogs": []
            }"#,
        );

        assert_eq!(
            manifest.resources[1],
            Resource {
                name: "meta".to_owned(),
                types: Some(vec!["movie".to_owned()]),
                id_prefixes: Some(vec!["tt".to_owned(), "tmdb".to_owned()]),
            }
        );
        assert_eq!(manifest.resources[2].id_prefixes, None);
    }

    #[test]
    fn a_catalog_is_read_with_its_type_and_id_and_name() {
        let manifest = parsed(
            r#"{
                "id": "org.example.addon",
                "name": "Example",
                "version": "1.0.0",
                "resources": ["catalog"],
                "types": ["movie"],
                "catalogs": [
                    { "type": "movie", "id": "top", "name": "Top",
                      "extra": [{ "name": "search", "isRequired": true }] }
                ]
            }"#,
        );

        assert_eq!(manifest.catalogs.len(), 1);
        assert_eq!(manifest.catalogs[0].r#type, "movie");
        assert_eq!(manifest.catalogs[0].id, "top");
        assert_eq!(manifest.catalogs[0].name, "Top");
    }

    #[test]
    fn a_catalog_without_a_name_shows_its_id_rather_than_nothing() {
        let manifest = parsed(
            r#"{
                "id": "org.example.addon",
                "name": "Example",
                "version": "1.0.0",
                "resources": ["catalog"],
                "types": ["movie"],
                "catalogs": [{ "type": "movie", "id": "top" }]
            }"#,
        );

        assert_eq!(manifest.catalogs[0].name, "top");
    }

    #[test]
    fn fields_this_host_has_no_use_for_are_ignored_not_refused() {
        let manifest = parsed(
            r#"{
                "id": "org.example.addon",
                "name": "Example",
                "version": "1.0.0",
                "description": "an example",
                "logo": "https://example.com/logo.png",
                "background": "https://example.com/bg.jpg",
                "contactEmail": "someone@example.com",
                "stremioAddonsConfig": { "issuer": "https://stremio-addons.net", "signature": "…" },
                "addonCatalogs": [{ "type": "movie", "id": "official" }],
                "cacheMaxAge": 3600,
                "staleRevalidate": 300,
                "staleError": 60,
                "resources": ["catalog"],
                "types": ["movie"],
                "catalogs": [],
                "idPrefixes": ["tt"],
                "behaviorHints": { "configurable": true, "configurationRequired": false }
            }"#,
        );

        assert_eq!(manifest.id_prefixes, vec!["tt"]);
        assert!(manifest.behavior_hints.configurable);
        assert!(!manifest.behavior_hints.configuration_required);
    }

    #[test]
    fn a_field_this_host_ignores_is_ignored_whatever_shape_it_has() {
        // Ignored means ignored: nothing is read out of it, so nothing about it
        // can be wrong either.
        let body = serde_json::json!({
            "id": "org.example.addon",
            "name": "Example",
            "version": "1.0.0",
            "description": 7,
            "logo": ["not", "a", "string"],
            "cacheMaxAge": { "nested": true },
            "resources": ["catalog"],
            "types": ["movie"],
            "catalogs": [],
        })
        .to_string();

        assert_eq!(parsed(&body).name, "Example");
    }

    #[test]
    fn a_body_that_is_not_json_is_refused() {
        for body in ["", "not json at all", "<html>hello</html>", "{"] {
            assert!(
                matches!(refused(body), ManifestError::NotJson { .. }),
                "{body:?} is not a manifest"
            );
        }
    }

    #[test]
    fn a_body_that_is_json_but_not_an_object_is_refused() {
        for body in ["[]", "\"a manifest\"", "5", "null", "true"] {
            assert!(
                matches!(refused(body), ManifestError::NotJson { .. }),
                "{body:?} is not a manifest"
            );
        }
    }

    #[test]
    fn a_missing_required_field_is_named() {
        for field in ["id", "name", "version", "resources", "types"] {
            let mut value: Value =
                serde_json::from_str(&minimal()).expect("the fixture is an object");
            value
                .as_object_mut()
                .expect("the fixture is an object")
                .remove(field);

            assert_eq!(
                refused(&value.to_string()),
                ManifestError::Missing {
                    field: field.to_owned()
                },
                "removing {field} should name it"
            );
        }
    }

    #[test]
    fn a_required_field_of_the_wrong_type_is_named() {
        let cases = [
            (r#""id": 7"#, "id", "a string"),
            (r#""name": ["Example"]"#, "name", "a string"),
            (r#""version": 1.0"#, "version", "a string"),
            (r#""resources": "catalog""#, "resources", "an array"),
            (
                r#""resources": [7]"#,
                "resources[0]",
                "a resource name, or an object describing one",
            ),
            (r#""types": "movie""#, "types", "an array of strings"),
            (r#""types": ["movie", 3]"#, "types[1]", "a string"),
            (r#""idPrefixes": "tt""#, "idPrefixes", "an array of strings"),
            (r#""catalogs": {}"#, "catalogs", "an array"),
            (r#""catalogs": [7]"#, "catalogs[0]", "an object"),
            (r#""behaviorHints": []"#, "behaviorHints", "an object"),
            (
                r#""behaviorHints": { "configurable": "yes" }"#,
                "behaviorHints.configurable",
                "true or false",
            ),
        ];

        for (field, named, expected) in cases {
            let body = format!(
                r#"{{ "id": "org.example.addon", "name": "Example", "version": "1.0.0",
                      "resources": ["catalog"], "types": ["movie"], "catalogs": [], {field} }}"#
            );

            assert_eq!(
                refused(&body),
                ManifestError::WrongType {
                    field: named.to_owned(),
                    expected,
                },
                "the body {body} has a {named} of the wrong type"
            );
        }
    }

    #[test]
    fn a_field_inside_a_resource_is_named_by_where_it_sits() {
        for (resource, named, expected) in [
            (r#"{ "name": 7 }"#, "resources[0].name", "a string"),
            (
                r#"{ "name": "meta", "types": "movie" }"#,
                "resources[0].types",
                "an array of strings",
            ),
            (
                r#"{ "name": "meta", "idPrefixes": 7 }"#,
                "resources[0].idPrefixes",
                "an array of strings",
            ),
        ] {
            let body = body_with_resources(&[json(resource)]);

            assert_eq!(
                refused(&body),
                ManifestError::WrongType {
                    field: named.to_owned(),
                    expected,
                },
                "the resource {resource} names {named}"
            );
        }
    }

    #[test]
    fn a_field_inside_a_catalog_is_named_by_where_it_sits() {
        for (catalog, named, expected) in [
            (
                r#"{ "type": "movie", "id": 7 }"#,
                "catalogs[0].id",
                "a string",
            ),
            (
                r#"{ "type": 7, "id": "top" }"#,
                "catalogs[0].type",
                "a string",
            ),
            (
                r#"{ "type": "movie", "id": "top", "name": 7 }"#,
                "catalogs[0].name",
                "a string",
            ),
        ] {
            let body = body_with_catalogs(catalog);

            assert_eq!(
                refused(&body),
                ManifestError::WrongType {
                    field: named.to_owned(),
                    expected,
                },
                "the catalog {catalog} names {named}"
            );
        }
    }

    #[test]
    fn something_missing_inside_a_resource_or_a_catalog_is_named_by_where_it_sits() {
        for (body, named) in [
            (
                body_with_resources(&[json(r#"{ "types": ["movie"] }"#)]),
                "resources[0].name",
            ),
            (
                body_with_catalogs(r#"{ "type": "movie" }"#),
                "catalogs[0].id",
            ),
            (body_with_catalogs(r#"{ "id": "top" }"#), "catalogs[0].type"),
        ] {
            assert_eq!(
                refused(&body),
                ManifestError::Missing {
                    field: named.to_owned()
                },
                "the body {body} is missing {named}"
            );
        }
    }

    /// A manifest with these resources and nothing else to complain about.
    fn body_with_resources(resources: &[Value]) -> String {
        serde_json::json!({
            "id": "org.example.addon",
            "name": "Example",
            "version": "1.0.0",
            "resources": resources,
            "types": ["movie"],
            "catalogs": [],
        })
        .to_string()
    }

    /// The same, with one catalog in it.
    fn body_with_catalogs(catalog: &str) -> String {
        serde_json::json!({
            "id": "org.example.addon",
            "name": "Example",
            "version": "1.0.0",
            "resources": ["catalog"],
            "types": ["movie"],
            "catalogs": [json(catalog)],
        })
        .to_string()
    }

    fn json(text: &str) -> Value {
        serde_json::from_str(text).unwrap_or_else(|error| panic!("{text} is JSON: {error}"))
    }

    #[test]
    fn a_required_field_that_is_null_is_refused_rather_than_read_as_absent() {
        for field in ["id", "name", "version", "resources", "types"] {
            let body = format!(
                r#"{{ "id": "org.example.addon", "name": "Example", "version": "1.0.0",
                      "resources": ["catalog"], "types": ["movie"], "{field}": null }}"#
            );

            assert!(
                matches!(refused(&body), ManifestError::WrongType { .. }),
                "{field}: null is not {field}"
            );
        }
    }

    #[test]
    fn a_required_string_that_is_empty_is_refused() {
        for field in ["id", "name", "version"] {
            let body = format!(
                r#"{{ "id": "org.example.addon", "name": "Example", "version": "1.0.0",
                      "resources": ["catalog"], "types": ["movie"], "{field}": "" }}"#
            );

            assert!(
                matches!(refused(&body), ManifestError::Invalid { field: named, .. } if named == field),
                "{field} is required to say something"
            );
        }
    }

    #[test]
    fn an_id_that_is_not_an_id_is_refused() {
        for not_an_id in ["", "an id with spaces", "an\nid"] {
            let body = serde_json::json!({
                "id": not_an_id,
                "name": "Example",
                "version": "1.0.0",
                "resources": [],
                "types": [],
                "catalogs": [],
            })
            .to_string();

            assert!(
                matches!(refused(&body), ManifestError::Invalid { field, .. } if field == "id"),
                "{not_an_id:?} is not an Addon id"
            );
        }
    }

    #[test]
    fn an_id_longer_than_the_host_holds_is_refused() {
        let body = format!(
            r#"{{ "id": "{}", "name": "Example", "version": "1.0.0",
                  "resources": [], "types": [], "catalogs": [] }}"#,
            "a".repeat(AddonId::MAX_LEN + 1)
        );

        assert!(matches!(
            refused(&body),
            ManifestError::Invalid { field, .. } if field == "id"
        ));
    }

    #[test]
    fn a_list_longer_than_the_host_holds_is_refused() {
        let too_many = vec!["movie"; MAX_ITEMS + 1];
        let body = serde_json::json!({
            "id": "org.example.addon",
            "name": "Example",
            "version": "1.0.0",
            "resources": ["catalog"],
            "types": too_many,
            "catalogs": [],
        })
        .to_string();

        assert_eq!(
            refused(&body),
            ManifestError::TooLarge {
                field: "types".to_owned(),
                limit: MAX_ITEMS,
            }
        );
    }

    #[test]
    fn a_string_longer_than_the_host_holds_is_refused() {
        let body = serde_json::json!({
            "id": "org.example.addon",
            "name": "x".repeat(MAX_STRING_LEN + 1),
            "version": "1.0.0",
            "resources": ["catalog"],
            "types": ["movie"],
            "catalogs": [],
        })
        .to_string();

        assert_eq!(
            refused(&body),
            ManifestError::TooLarge {
                field: "name".to_owned(),
                limit: MAX_STRING_LEN,
            }
        );
    }

    #[test]
    fn a_body_longer_than_the_host_holds_is_refused_before_it_is_parsed() {
        let body = format!("{} {}", " ".repeat(MAX_MANIFEST_BYTES), "{");

        assert_eq!(
            refused(&body),
            ManifestError::TooLarge {
                field: "the manifest".to_owned(),
                limit: MAX_MANIFEST_BYTES,
            }
        );
    }

    #[test]
    fn a_missing_optional_field_reads_as_absent_and_a_null_one_too() {
        for catalogs in [
            Some(serde_json::json!([])),
            Some(serde_json::Value::Null),
            None,
        ] {
            let mut value = serde_json::json!({
                "id": "org.example.addon",
                "name": "Example",
                "version": "1.0.0",
                "resources": ["catalog"],
                "types": ["movie"],
                "idPrefixes": null,
                "behaviorHints": null,
            });
            if let Some(catalogs) = catalogs {
                value["catalogs"] = catalogs;
            }

            let manifest = parsed(&value.to_string());

            assert_eq!(manifest.id_prefixes, Vec::<String>::new());
            assert_eq!(manifest.catalogs, Vec::<Catalog>::new());
            assert_eq!(manifest.behavior_hints, BehaviorHints::default());
        }
    }

    #[test]
    fn a_manifest_url_must_be_an_absolute_http_address() {
        for url in [
            "https://example.com/manifest.json",
            "http://example.com/manifest.json",
            "https://example.com",
            "https://example.com:8443/a/b?c=d",
        ] {
            assert_eq!(
                ManifestUrl::parse(url).map(|url| url.as_str().to_owned()),
                Ok(url.to_owned()),
                "{url} is a manifest URL"
            );
        }

        for not_a_url in [
            "",
            "example.com/manifest.json",
            "//example.com/manifest.json",
            "https://",
            "file:///etc/passwd",
            "ftp://example.com/manifest.json",
            "stremio://example.com/manifest.json",
            "https://exa mple.com/manifest.json",
        ] {
            assert!(
                ManifestUrl::parse(not_a_url).is_err(),
                "{not_a_url:?} is not a manifest URL"
            );
        }
    }

    #[test]
    fn a_manifest_url_longer_than_the_host_holds_is_refused() {
        let url = format!("https://example.com/{}", "a".repeat(MAX_URL_LEN));

        assert!(ManifestUrl::parse(&url).is_err());
    }

    #[test]
    fn a_manifest_read_back_from_storage_is_judged_the_same_way_a_fetched_one_is() {
        // The Host stores its own reading of a manifest. Reading it back goes
        // through the same judgements, so a value the parser refuses cannot get in
        // by arriving from the database instead of from the network.
        let stored = r#"{
            "id": "an id with spaces",
            "name": "Example",
            "version": "1.0.0",
            "resources": [],
            "types": ["movie"],
            "catalogs": [],
            "idPrefixes": [],
            "behaviorHints": { "configurable": false, "configurationRequired": false }
        }"#;

        assert!(
            serde_json::from_str::<Manifest>(stored).is_err(),
            "an Addon id the parser refuses is refused however it arrives"
        );
    }

    #[test]
    fn the_manifest_url_is_not_part_of_what_an_addon_publishes() {
        let published = serde_json::to_value(parsed(&minimal())).expect("a manifest serializes");

        assert_eq!(
            published,
            serde_json::json!({
                "id": "org.example.addon",
                "name": "Example",
                "version": "1.2.3",
                "resources": [
                    { "name": "catalog", "types": null, "idPrefixes": null },
                    { "name": "meta", "types": null, "idPrefixes": null },
                ],
                "types": ["movie", "series"],
                "catalogs": [],
                "idPrefixes": [],
                "behaviorHints": { "configurable": false, "configurationRequired": false },
            }),
            "the wire shape is the declared one, camelCased for a JavaScript client"
        );
    }

    /// A manifest body with one catalog taking these `extra` properties, written
    /// the long way or the short one.
    fn body_with_catalog_extras(extra: &str) -> String {
        format!(
            r#"{{ "id": "org.example.addon", "name": "Example", "version": "1.0.0",
                  "resources": ["catalog"], "types": ["movie"],
                  "catalogs": [{{ "type": "movie", "id": "top", "name": "Top", {extra} }}] }}"#
        )
    }

    #[test]
    fn a_catalogs_controls_are_read_in_the_long_form() {
        let manifest = parsed(&body_with_catalog_extras(
            r#""extra": [
                { "name": "search", "isRequired": true },
                { "name": "genre", "options": ["Action", "Comedy"], "optionsLimit": 2 },
                { "name": "skip" }
            ]"#,
        ));

        assert_eq!(
            manifest.catalogs[0].extra,
            vec![
                ExtraProp::named("search").required(),
                ExtraProp::named("genre").offering(&["Action", "Comedy"]),
                ExtraProp::named("skip"),
            ],
            "a control is read with what it offers and whether it is required"
        );
    }

    #[test]
    fn a_catalogs_controls_are_read_in_the_short_form_too() {
        let manifest = parsed(&body_with_catalog_extras(
            r#""extraSupported": ["search", "skip"], "extraRequired": ["search"]"#,
        ));

        assert_eq!(
            manifest.catalogs[0].extra,
            vec![
                ExtraProp::named("search").required(),
                ExtraProp::named("skip"),
            ]
        );
    }

    #[test]
    fn a_catalog_that_says_it_both_ways_is_read_the_way_that_carries_the_options() {
        let manifest = parsed(&body_with_catalog_extras(
            r#""extra": [{ "name": "genre", "options": ["Action"] }],
                "extraSupported": ["genre", "skip"]"#,
        ));

        assert_eq!(
            manifest.catalogs[0].extra,
            vec![ExtraProp::named("genre").offering(&["Action"])],
            "the short form cannot carry options, so the long one wins when it is there"
        );
    }

    #[test]
    fn a_control_of_the_wrong_shape_is_named_by_where_it_sits() {
        for (extra, named, expected) in [
            (
                r#""extra": [7]"#,
                "catalogs[0].extra[0]",
                "an object describing an extra",
            ),
            (
                r#""extra": [{ "name": "genre", "options": "Action" }]"#,
                "catalogs[0].extra[0].options",
                "an array of strings",
            ),
            (
                r#""extra": [{ "name": "genre", "isRequired": "yes" }]"#,
                "catalogs[0].extra[0].isRequired",
                "true or false",
            ),
        ] {
            assert_eq!(
                refused(&body_with_catalog_extras(extra)),
                ManifestError::WrongType {
                    field: named.to_owned(),
                    expected,
                },
                "the control {extra} names {named}"
            );
        }

        assert_eq!(
            refused(&body_with_catalog_extras(
                r#""extra": [{ "isRequired": true }]"#
            )),
            ManifestError::Missing {
                field: "catalogs[0].extra[0].name".to_owned()
            },
            "an extra is named even when all that is missing is its name"
        );
    }

    #[test]
    fn a_catalog_takes_the_values_it_offers_and_the_ones_it_requires() {
        let catalog = Catalog {
            r#type: "movie".to_owned(),
            id: "top".to_owned(),
            name: "Top".to_owned(),
            extra: vec![
                ExtraProp::named("search").required(),
                ExtraProp::named("skip"),
            ],
        };

        assert!(
            catalog.takes_extra(&[Extra::of("search", "matrix")]),
            "the required value is there"
        );
        assert!(
            catalog.takes_extra(&[Extra::of("search", "matrix"), Extra::of("skip", "100")]),
            "and an optional one may come along"
        );
        assert!(
            !catalog.takes_extra(&[Extra::of("skip", "100")]),
            "a required value that is missing is not taken"
        );
        assert!(
            !catalog.takes_extra(&[Extra::of("search", "matrix"), Extra::of("sort", "new")]),
            "a value the catalog never declared is not taken"
        );
    }

    #[test]
    fn a_catalog_that_requires_a_value_offering_none_cannot_be_asked_for_on_its_own() {
        let askable = parsed(&body_with_catalog_extras(
            r#""extra": [{ "name": "skip" }]"#,
        ));
        let not_askable = parsed(&body_with_catalog_extras(
            r#""extra": [{ "name": "lastVideosIds", "isRequired": true }]"#,
        ));

        assert_eq!(askable.catalogs[0].default_extra(), Some(Vec::new()));
        assert_eq!(
            not_askable.catalogs[0].default_extra(),
            None,
            "a catalog with nothing to choose from is not a row"
        );
    }

    #[test]
    fn the_values_a_client_chose_stand_and_the_rest_are_filled_in() {
        let manifest = parsed(&body_with_catalog_extras(
            r#""extra": [{ "name": "genre", "options": ["Action", "Comedy"], "isRequired": true },
                          { "name": "skip" }]"#,
        ));
        let catalog = &manifest.catalogs[0];

        assert_eq!(
            catalog.with_defaults(vec![Extra::of("skip", "100")]),
            vec![Extra::of("skip", "100"), Extra::of("genre", "Action")],
            "what the client chose stands, and what it left out is filled in"
        );
        assert_eq!(
            catalog.with_defaults(vec![Extra::of("genre", "Comedy")]),
            vec![Extra::of("genre", "Comedy")],
            "a value the client chose is not replaced by the default"
        );
    }

    #[test]
    fn asking_a_catalog_for_itself_fills_in_the_values_it_requires() {
        let manifest = parsed(&body_with_catalog_extras(
            r#""extra": [{ "name": "genre", "options": ["Action", "Comedy"], "isRequired": true },
                          { "name": "skip" }]"#,
        ));

        assert_eq!(
            manifest.catalogs[0].default_extra(),
            Some(vec![Extra::of("genre", "Action")]),
            "the first value offered is the one to start from"
        );
    }

    #[test]
    fn searching_a_catalog_carries_the_query_and_the_other_values_it_requires() {
        let manifest = parsed(&body_with_catalog_extras(
            r#""extra": [{ "name": "search", "isRequired": true },
                          { "name": "genre", "options": ["Action"], "isRequired": true }]"#,
        ));

        assert_eq!(
            manifest.catalogs[0].search_extra("matrix"),
            Some(vec![
                Extra::of("genre", "Action"),
                Extra::of("search", "matrix"),
            ]),
            "the query takes the place of the search property's default"
        );

        let unsearchable = parsed(&body_with_catalog_extras(
            r#""extra": [{ "name": "skip" }]"#,
        ));
        assert_eq!(
            unsearchable.catalogs[0].search_extra("matrix"),
            None,
            "a catalog that offers no search is not asked to search"
        );
    }

    #[test]
    fn a_resource_is_asked_only_for_the_types_and_prefixes_it_reaches() {
        let manifest = parsed(
            r#"{
                "id": "org.example.addon",
                "name": "Example",
                "version": "1.0.0",
                "resources": [
                    "catalog",
                    { "name": "meta", "types": ["movie"], "idPrefixes": ["tt"] },
                    { "name": "stream", "types": ["movie", "series"] }
                ],
                "types": ["movie", "series"],
                "catalogs": [{ "type": "movie", "id": "top", "name": "Top" }]
            }"#,
        );

        let asked = |resource: &str, r#type: &str, id: &str| {
            manifest.answers(&ResourceRequest::new(resource, r#type, id))
        };

        assert!(
            asked("meta", "movie", "tt0111161"),
            "the type and the prefix are both covered"
        );
        assert!(
            !asked("meta", "movie", "kitsu:42"),
            "an id the Addon never said it reaches is not its business"
        );
        assert!(
            !asked("meta", "series", "tt0903747"),
            "nor is a type it never named"
        );
        assert!(
            asked("stream", "movie", "kitsu:42"),
            "a resource that names no prefixes reaches every id"
        );
        assert!(
            !asked("subtitles", "movie", "tt0111161"),
            "a resource the Addon never declared is never asked for"
        );
    }

    #[test]
    fn a_resource_that_names_an_empty_list_of_prefixes_reaches_every_id() {
        // The protocol says so in as many words, and Stremio's client implements it.
        let manifest = parsed(
            r#"{ "id": "org.example.addon", "name": "Example", "version": "1.0.0",
                 "resources": ["catalog", { "name": "meta", "types": ["movie"], "idPrefixes": [] }],
                 "types": ["movie"], "catalogs": [] }"#,
        );

        assert!(manifest.answers(&ResourceRequest::new("meta", "movie", "anything")));
    }

    #[test]
    fn a_resource_that_names_no_types_reaches_the_manifests_own() {
        // The short form says exactly that, and a stored manifest cannot tell the
        // two forms apart — so an untyped resource reaches what the Addon says it
        // covers rather than nothing at all.
        let manifest = parsed(
            r#"{ "id": "org.example.addon", "name": "Example", "version": "1.0.0",
                 "resources": ["catalog", { "name": "meta" }],
                 "types": ["movie"], "catalogs": [] }"#,
        );

        assert!(manifest.answers(&ResourceRequest::new("meta", "movie", "tt1")));
        assert!(!manifest.answers(&ResourceRequest::new("meta", "series", "tt1")));
    }

    #[test]
    fn a_catalog_is_asked_for_by_the_id_it_declared_and_not_by_its_prefixes() {
        // `idPrefixes` is not a catalog's rule: a catalog is reached through its
        // own id, and the protocol says the filtering does not apply.
        let manifest = parsed(
            r#"{ "id": "org.example.addon", "name": "Example", "version": "1.0.0",
                 "resources": ["catalog"], "types": ["movie"], "idPrefixes": ["tt"],
                 "catalogs": [{ "type": "movie", "id": "top", "name": "Top" }] }"#,
        );

        assert!(manifest.answers(&ResourceRequest::new("catalog", "movie", "top")));
        assert!(
            !manifest.answers(&ResourceRequest::new("catalog", "movie", "tt0111161")),
            "a catalog that was never declared is not one to ask for, whatever the prefixes say"
        );
    }
}
