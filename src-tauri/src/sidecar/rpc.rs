use crate::bridge::Sidecar;
use crate::error::AppError;
use crate::sidecar::dto::ProfileDto;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Deserialize)]
pub struct UnmaskResult {
    pub url: String,
    pub status: u16,
}

#[derive(Debug, Deserialize)]
pub struct RpcHeaderPair {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
pub struct GofileFileRpc {
    pub id: String,
    #[serde(rename = "directUrl")]
    pub direct_url: String,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "fileSize", default)]
    pub file_size: Option<u64>,
    #[serde(rename = "platformLabel", default)]
    pub platform_label: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GofileResolveResult {
    pub files: Vec<GofileFileRpc>,
    #[serde(rename = "extraHeaders", default)]
    pub extra_headers: Vec<RpcHeaderPair>,
}

#[derive(Debug, Deserialize)]
pub struct HostResolveResult {
    #[serde(rename = "directUrl")]
    pub direct_url: String,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "fileSize", default)]
    pub file_size: Option<u64>,
    #[serde(rename = "extraHeaders", default)]
    pub extra_headers: Vec<RpcHeaderPair>,
}

#[derive(Debug, Deserialize)]
struct LoggedInResult {
    #[serde(rename = "loggedIn")]
    logged_in: bool,
}

/// Typed RPC facade over the raw [`Sidecar`] transport.
pub struct SidecarClient {
    inner: Arc<Sidecar>,
}

impl SidecarClient {
    pub fn new(inner: Arc<Sidecar>) -> Self {
        Self { inner }
    }

    pub fn inner(&self) -> &Arc<Sidecar> {
        &self.inner
    }

    pub async fn init(&self, session_dir: &str, session_id: &str) -> Result<(), AppError> {
        self.inner
            .call(
                "init",
                json!({ "sessionDir": session_dir, "sessionId": session_id }),
            )
            .await?;
        Ok(())
    }

    pub async fn ping(&self) -> Result<(), AppError> {
        self.inner.call("ping", json!({})).await?;
        Ok(())
    }

    pub async fn login(&self, username: &str, password: &str) -> Result<(), AppError> {
        self.inner
            .call(
                "login",
                json!({ "username": username, "password": password }),
            )
            .await?;
        Ok(())
    }

    pub async fn get_profile(&self) -> Result<ProfileDto, AppError> {
        let value: Value = self.inner.call("getProfile", json!({})).await?;
        Ok(serde_json::from_value(value)?)
    }

    /// Public profile of an arbitrary member. Raw JSON passthrough (typed
    /// on the frontend as `MemberProfileDto`), same policy as `get_following`.
    pub async fn get_member_profile(&self, user_id: &str) -> Result<Value, AppError> {
        self.inner
            .call("getMemberProfile", json!({ "userId": user_id }))
            .await
    }

    pub async fn is_logged_in(&self) -> Result<bool, AppError> {
        let value: Value = self.inner.call("isLoggedIn", json!({})).await?;
        let parsed: LoggedInResult = serde_json::from_value(value)?;
        Ok(parsed.logged_in)
    }

    pub async fn sam_list(&self, filters: Value) -> Result<Value, AppError> {
        self.inner
            .call("samList", json!({ "filters": filters }))
            .await
    }

    pub async fn sam_tag_search(&self, category: &str, search: &str) -> Result<Value, AppError> {
        self.inner
            .call(
                "samTagSearch",
                json!({ "category": category, "search": search }),
            )
            .await
    }

    pub async fn sam_options(&self, category: &str) -> Result<Value, AppError> {
        self.inner
            .call("samOptions", json!({ "category": category }))
            .await
    }

    pub async fn game_detail(&self, thread_id: &str) -> Result<Value, AppError> {
        self.inner
            .call("gameDetail", json!({ "threadId": thread_id }))
            .await
    }

    pub async fn get_following(&self) -> Result<Value, AppError> {
        self.inner.call("getFollowing", json!({})).await
    }

    pub async fn fetch_rss(&self, params: serde_json::Map<String, Value>) -> Result<Value, AppError> {
        self.inner.call("fetchRss", Value::Object(params)).await
    }

    pub async fn fetch_alerts_popup(&self) -> Result<Value, AppError> {
        self.inner.call("fetchAlertsPopup", json!({})).await
    }

    pub async fn fetch_alerts_list(
        &self,
        params: serde_json::Map<String, Value>,
    ) -> Result<Value, AppError> {
        self.inner.call("fetchAlertsList", Value::Object(params)).await
    }

    pub async fn unmask_url(&self, url: &str) -> Result<UnmaskResult, AppError> {
        let value = self.inner.call("unmaskUrl", json!({ "url": url })).await?;
        Ok(serde_json::from_value(value)?)
    }

    pub async fn resolve_gdrive(&self, url: &str) -> Result<HostResolveResult, AppError> {
        let value = self
            .inner
            .call("resolveGdrive", json!({ "url": url }))
            .await?;
        Ok(serde_json::from_value(value)?)
    }

    pub async fn resolve_buzzheavier(
        &self,
        url: &str,
        account_id: Option<&str>,
    ) -> Result<HostResolveResult, AppError> {
        let mut params = json!({ "url": url });
        if let Some(id) = account_id.filter(|s| !s.is_empty()) {
            params["accountId"] = json!(id);
        }
        let value = self.inner.call("resolveBuzzheavier", params).await?;
        Ok(serde_json::from_value(value)?)
    }

    pub async fn resolve_datanodes(&self, url: &str) -> Result<HostResolveResult, AppError> {
        let value = self
            .inner
            .call("resolveDatanodes", json!({ "url": url }))
            .await?;
        Ok(serde_json::from_value(value)?)
    }

    pub async fn resolve_workupload(&self, url: &str) -> Result<HostResolveResult, AppError> {
        let value = self
            .inner
            .call("resolveWorkupload", json!({ "url": url }))
            .await?;
        Ok(serde_json::from_value(value)?)
    }

    pub async fn resolve_gofile(
        &self,
        url: &str,
        account_token: Option<&str>,
    ) -> Result<GofileResolveResult, AppError> {
        let mut params = json!({ "url": url });
        if let Some(token) = account_token.filter(|s| !s.is_empty()) {
            params["accountToken"] = json!(token);
        }
        let value = self
            .inner
            .call_with_timeout("resolveGofile", params, Duration::from_secs(180))
            .await?;
        Ok(serde_json::from_value(value)?)
    }

    pub async fn resolve_mixdrop(
        &self,
        url: &str,
        api_email: Option<&str>,
        api_key: Option<&str>,
    ) -> Result<HostResolveResult, AppError> {
        let mut params = json!({ "url": url });
        if let Some(email) = api_email.filter(|s| !s.is_empty()) {
            params["apiEmail"] = json!(email);
        }
        if let Some(key) = api_key.filter(|s| !s.is_empty()) {
            params["apiKey"] = json!(key);
        }
        let value = self.inner.call("resolveMixdrop", params).await?;
        Ok(serde_json::from_value(value)?)
    }

    pub async fn resolve_mixdrop_with_cookies(
        &self,
        url: &str,
        cookie_header: &str,
        api_email: Option<&str>,
        api_key: Option<&str>,
    ) -> Result<HostResolveResult, AppError> {
        let mut params = json!({ "url": url, "cookieHeader": cookie_header });
        if let Some(email) = api_email.filter(|s| !s.is_empty()) {
            params["apiEmail"] = json!(email);
        }
        if let Some(key) = api_key.filter(|s| !s.is_empty()) {
            params["apiKey"] = json!(key);
        }
        let value = self.inner.call("resolveMixdropWithCookies", params).await?;
        Ok(serde_json::from_value(value)?)
    }

    pub async fn resolve_mixdrop_interactive(
        &self,
        url: &str,
        api_email: Option<&str>,
        api_key: Option<&str>,
    ) -> Result<HostResolveResult, AppError> {
        let mut params = json!({ "url": url });
        if let Some(email) = api_email.filter(|s| !s.is_empty()) {
            params["apiEmail"] = json!(email);
        }
        if let Some(key) = api_key.filter(|s| !s.is_empty()) {
            params["apiKey"] = json!(key);
        }
        let value = self
            .inner
            .call_with_timeout(
                "resolveMixdropInteractive",
                params,
                Duration::from_secs(360),
            )
            .await?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn kill_now(&self) {
        self.inner.kill_now();
    }
}
