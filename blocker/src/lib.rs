mod import;

use std::ffi::{c_char, c_int, CStr, CString};
use std::os::raw::c_void;
use std::ptr;

use adblock::lists::{FilterSet, ParseOptions};
use adblock::request::Request;
use adblock::Engine;

pub struct Blocker {
    engine: Engine,
    rules: usize,
}

fn cstr(ptr: *const c_char) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    unsafe { CStr::from_ptr(ptr) }.to_str().ok().map(str::to_owned)
}

#[no_mangle]
pub extern "C" fn tobari_blocker_new(paths: *const *const c_char, count: usize) -> *mut c_void {
    if paths.is_null() {
        return ptr::null_mut();
    }
    let slice = unsafe { std::slice::from_raw_parts(paths, count) };
    let mut set = FilterSet::new(false);
    let mut rules = 0usize;

    for entry in slice {
        let Some(path) = cstr(*entry) else { continue };
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        rules += text
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('!') && !l.starts_with("[Adblock"))
            .count();
        set.add_filter_list(text, ParseOptions::default());
    }

    let engine = Engine::new_with_filter_set(set);
    Box::into_raw(Box::new(Blocker { engine, rules })) as *mut c_void
}

#[no_mangle]
pub extern "C" fn tobari_blocker_free(handle: *mut c_void) {
    if handle.is_null() {
        return;
    }
    unsafe { drop(Box::from_raw(handle as *mut Blocker)) };
}

#[no_mangle]
pub extern "C" fn tobari_blocker_rule_count(handle: *const c_void) -> usize {
    if handle.is_null() {
        return 0;
    }
    unsafe { &*(handle as *const Blocker) }.rules
}

#[no_mangle]
pub extern "C" fn tobari_blocker_should_block(
    handle: *const c_void,
    url: *const c_char,
    source_url: *const c_char,
    request_type: *const c_char,
    method: *const c_char,
) -> c_int {
    if handle.is_null() {
        return 0;
    }
    let blocker = unsafe { &*(handle as *const Blocker) };
    let (Some(url), Some(source), Some(kind)) = (cstr(url), cstr(source_url), cstr(request_type))
    else {
        return 0;
    };
    let verb = cstr(method).unwrap_or_else(|| "GET".to_owned());
    let Ok(request) = Request::new(&url, &source, &kind, &verb) else {
        return 0;
    };
    let result = blocker.engine.check_network_request(&request);
    if result.filter.is_some() && result.exception.is_none() {
        1
    } else {
        0
    }
}

/// Writes the registrable domain (eTLD+1) of |host| into |out| as a
/// NUL-terminated string and returns its length, or 0 when the host has none
/// (an IP literal, a bare public suffix, or a single label like localhost).
#[no_mangle]
pub extern "C" fn tobari_registrable_domain(host: *const c_char, out: *mut c_char, cap: usize) -> usize {
    let Some(host) = cstr(host) else { return 0 };
    if out.is_null() || cap == 0 {
        return 0;
    }
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let Some(domain) = psl::domain_str(&host) else { return 0 };
    let bytes = domain.as_bytes();
    if bytes.len() + 1 > cap {
        return 0;
    }
    unsafe {
        ptr::copy_nonoverlapping(bytes.as_ptr(), out as *mut u8, bytes.len());
        *out.add(bytes.len()) = 0;
    }
    bytes.len()
}

/// Runs one import operation (see import.rs): "sources", or "cookies",
/// "bookmarks", "history", "extensions" for a source id from "sources".
/// Returns a NUL-terminated JSON string to free with tobari_free_string.
#[no_mangle]
pub extern "C" fn tobari_import(op: *const c_char, arg: *const c_char) -> *mut c_char {
    let op = cstr(op).unwrap_or_default();
    let arg = cstr(arg).unwrap_or_default();
    let out = import::run(&op, &arg).to_string();
    CString::new(out).map(CString::into_raw).unwrap_or(ptr::null_mut())
}

#[no_mangle]
pub extern "C" fn tobari_free_string(s: *mut c_char) {
    if !s.is_null() {
        unsafe { drop(CString::from_raw(s)) };
    }
}
