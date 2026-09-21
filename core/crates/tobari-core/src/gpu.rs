

#[derive(Debug, Clone)]
pub struct GpuInfo {
    pub backend: Backend,
    pub vram_gb: f64,
    pub device_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Backend {
    Vulkan,
    Cuda,
    #[allow(dead_code)]
    Metal,
    Cpu,
}

impl Backend {
    pub fn as_str(self) -> &'static str {
        match self {
            Backend::Vulkan => "vulkan",
            Backend::Cuda => "cuda",
            Backend::Metal => "metal",
            Backend::Cpu => "cpu",
        }
    }
}

#[cfg(target_os = "macos")]
pub fn detect() -> GpuInfo {
    let device_name = std::process::Command::new("sysctl")
        .arg("-n")
        .arg("hw.model")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "Apple Silicon".to_string());
    GpuInfo {
        backend: Backend::Metal,
        vram_gb: metal_device_memory_gb(),
        device_name,
    }
}

#[cfg(target_os = "macos")]
fn metal_device_memory_gb() -> f64 {
    std::process::Command::new("sysctl")
        .arg("-n")
        .arg("hw.memsize")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
        .map(|bytes| bytes as f64 / 1024.0 / 1024.0 / 1024.0 * 0.65)
        .unwrap_or(8.0)
}

#[cfg(target_os = "linux")]
pub fn detect() -> GpuInfo {
    nvidia().or_else(vulkan).unwrap_or(GpuInfo {
        backend: Backend::Cpu,
        vram_gb: 0.0,
        device_name: "no discrete GPU detected".to_string(),
    })
}

#[cfg(target_os = "linux")]
fn nvidia() -> Option<GpuInfo> {
    let output = std::process::Command::new("nvidia-smi")
        .arg("--query-gpu=name,memory.total")
        .arg("--format=csv,noheader,nounits")
        .output()
        .ok()?;
    let text = String::from_utf8(output.stdout).ok()?;
    let line = text.lines().next()?;
    let mut parts = line.split(',');
    let name = parts.next()?.trim().to_string();
    let mib: f64 = parts.next()?.trim().parse().ok()?;
    Some(GpuInfo {
        backend: Backend::Cuda,
        vram_gb: mib / 1024.0,
        device_name: name,
    })
}

#[cfg(target_os = "linux")]
fn vulkan() -> Option<GpuInfo> {
    let output = std::process::Command::new("vulkaninfo")
        .arg("--summary")
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    let text = String::from_utf8(output.stdout).ok()?;
    let mut vram_gb = 0.0;
    let mut device_name = String::new();
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("\tdeviceName") {
            device_name = rest.trim().trim_start_matches('=').trim().to_string();
        }
        if let Some(rest) = line.strip_prefix("\theapBudget") {
            let value = rest.trim().trim_start_matches('=').trim().to_string();
            vram_gb = parse_vulkan_bytes(&value) / 1024.0 / 1024.0 / 1024.0;
        }
    }
    if device_name.is_empty() || vram_gb <= 0.0 {
        return None;
    }
    Some(GpuInfo {
        backend: Backend::Vulkan,
        vram_gb,
        device_name,
    })
}

#[cfg(target_os = "linux")]
fn parse_vulkan_bytes(value: &str) -> f64 {
    let value = value.trim();
    let bytes: u64 = value
        .trim_end_matches(char::is_alphabetic)
        .trim()
        .parse()
        .unwrap_or(0);
    match value.chars().last() {
        Some('K') => bytes as f64 * 1024.0,
        Some('M') => bytes as f64 * 1024.0 * 1024.0,
        Some('G') => bytes as f64 * 1024.0 * 1024.0 * 1024.0,
        Some('T') => bytes as f64 * 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => bytes as f64,
    }
}

pub fn gpu_layer_budget(model_bytes: u64, vram_gb: f64) -> u32 {
    let usable = vram_gb * 0.92 * 1024.0 * 1024.0 * 1024.0;
    if model_bytes == 0 || usable <= 0.0 {
        return 0;
    }
    let ratio = usable / model_bytes as f64;
    if ratio >= 1.0 {
        999
    } else if ratio >= 0.3 {
        ((ratio * 100.0).round() as u32).min(99)
    } else {
        0
    }
}

