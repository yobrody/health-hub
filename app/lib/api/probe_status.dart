/// Connectivity/health status for the backend API probe.
///
/// - [online]   — reachable and returned a successful 2xx response.
/// - [degraded] — reachable but returned a server-side error (5xx).
/// - [offline]  — could not reach the server (no network / connection refused).
enum ProbeStatus { online, degraded, offline }
