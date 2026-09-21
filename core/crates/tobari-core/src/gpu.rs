

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
fn vram_from_sysfs() -> Option<f64> {
    let entries = std::fs::read_dir("/sys/class/drm").ok()?;
    let mut largest: u64 = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("card") || name.contains('-') {
            continue;
        }
        let total = entry.path().join("device/mem_info_vram_total");
        let Ok(raw) = std::fs::read_to_string(&total) else {
            continue;
        };
        let Ok(bytes) = raw.trim().parse::<u64>() else {
            continue;
        };
        if bytes > largest {
            largest = bytes;
        }
    }
    if largest == 0 {
        return None;
    }
    Some(largest as f64 / 1024.0 / 1024.0 / 1024.0)
}

#[cfg(target_os = "linux")]
fn vulkan() -> Option<GpuInfo> {
    let output = std::process::Command::new("vulkaninfo")
        .arg("--summary")
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    let text = String::from_utf8(output.stdout).ok()?;
    let mut discrete_name: Option<String> = None;
    let mut any_name: Option<String> = None;
    let mut current_type = String::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("deviceType") {
            current_type = rest.trim().trim_start_matches('=').trim().to_string();
        }
        if let Some(rest) = trimmed.strip_prefix("deviceName") {
            let name = rest.trim().trim_start_matches('=').trim().to_string();
            if name.to_ascii_lowercase().contains("llvmpipe") {
                continue;
            }
            if current_type.contains("DISCRETE") && discrete_name.is_none() {
                discrete_name = Some(name.clone());
            }
            if any_name.is_none() {
                any_name = Some(name);
            }
        }
    }
    let device_name = discrete_name.or(any_name)?;
    let vram_gb = vram_from_sysfs()?;
    if vram_gb <= 0.0 {
        return None;
    }
    Some(GpuInfo {
        backend: Backend::Vulkan,
        vram_gb,
        device_name,
    })
}

pub fn cpu_fallback_reason() -> &'static str {
    "no usable GPU detected — running on CPU. Responses will be slow, and the model will occupy system RAM instead of VRAM."
}

pub const ALL_LAYERS: u32 = 999;

pub fn gpu_layer_budget(model_bytes: u64, vram_gb: f64) -> u32 {
    let usable = vram_gb * 0.90 * 1024.0 * 1024.0 * 1024.0;
    if model_bytes == 0 || usable <= 0.0 {
        return 0;
    }
    let ratio = usable / model_bytes as f64;
    if ratio >= 1.0 {
        ALL_LAYERS
    } else if ratio >= 0.25 {
        ((ratio * 100.0).round() as u32).min(ALL_LAYERS - 1)
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::{gpu_layer_budget, ALL_LAYERS};

    #[test]
    fn model_that_fits_gets_all_layers() {
        let model = 2_497_281_120u64;
        let vram = 16.0;
        assert_eq!(gpu_layer_budget(model, vram), ALL_LAYERS);
    }

    #[test]
    fn oversized_model_gets_a_partial_split_not_all_layers() {
        let model = 18_556_686_752u64;
        let vram = 16.0;
        let layers = gpu_layer_budget(model, vram);
        assert!(layers > 0 && layers < ALL_LAYERS, "got {layers}");
    }

    #[test]
    fn no_vram_means_no_offload() {
        assert_eq!(gpu_layer_budget(2_497_281_120, 0.0), 0);
    }
}


