fn main() {
    // `tauri dev` launches the macOS executable directly instead of an
    // `.app` bundle, so the bundle plist configured in tauri.conf.json is
    // unavailable to AppKit/WebKit while developing. Embed the localization
    // metadata in the executable as well; this is also harmless for release
    // builds, whose packaged bundle has its own generated Info.plist.
    #[cfg(target_os = "macos")]
    {
        let info_plist = std::path::PathBuf::from(
            std::env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set"),
        )
        .join("Info.plist");
        println!("cargo:rerun-if-changed={}", info_plist.display());
        println!("cargo:rustc-link-arg-bin=flowix-desktop=-sectcreate");
        println!("cargo:rustc-link-arg-bin=flowix-desktop=__TEXT");
        println!("cargo:rustc-link-arg-bin=flowix-desktop=__info_plist");
        println!("cargo:rustc-link-arg-bin=flowix-desktop={}", info_plist.display());
    }

    tauri_build::build()
}
