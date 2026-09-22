#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    Vulkan,
    Cuda,
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

    pub fn is_gpu(self) -> bool {
        self != Backend::Cpu
    }
}

pub fn detect() -> Backend {
    #[cfg(target_os = "macos")]
    {
        return Backend::Metal;
    }
    #[cfg(not(target_os = "macos"))]
    {
        if std::env::var("TOBARI_FORCE_CPU").is_ok() {
            return Backend::Cpu;
        }
        if cuda_toolkit_present() {
            return Backend::Cuda;
        }
        if vulkan_icd_present() {
            return Backend::Vulkan;
        }
        Backend::Cpu
    }
}

fn cuda_toolkit_present() -> bool {
    for candidate in [
        "/usr/local/cuda/bin/nvcc",
        "/usr/bin/nvcc",
        "/opt/cuda/bin/nvcc",
    ] {
        if std::path::Path::new(candidate).is_file() {
            return true;
        }
    }
    std::process::Command::new("nvidia-smi")
        .arg("-L")
        .output()
        .map(|o| o.status.success() && !o.stdout.is_empty())
        .unwrap_or(false)
        && std::path::Path::new("/usr/local/cuda").exists()
}

fn vulkan_icd_present() -> bool {
    for dir in [
        "/usr/share/vulkan/icd.d",
        "/etc/vulkan/icd.d",
        "/usr/local/share/vulkan/icd.d",
    ] {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.ends_with(".json") {
                    return true;
                }
            }
        }
    }
    false
}

pub fn llama_backend_flag(backend: Backend) -> &'static str {
    match backend {
        Backend::Vulkan => "--vulkan",
        Backend::Cuda => "--cuda",
        Backend::Metal => "--metal",
        Backend::Cpu => "",
    }
}
