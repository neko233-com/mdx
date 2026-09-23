#!/bin/sh
set -eu

if [ "$(uname -s)" != Darwin ]; then
  echo 'MDX supports macOS and Windows. Use install.ps1 on Windows.' >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) arch=aarch64 ;;
  x86_64) arch=x86_64 ;;
  *) echo 'Unsupported Mac architecture.' >&2; exit 1 ;;
esac

release='https://github.com/neko233-com/mdx/releases/latest/download'
mirror="${MDX_MIRROR_BASE:-https://ghproxy.net}"
mirror="${mirror%/}"
case "$mirror" in https://*) ;; *) echo 'MDX_MIRROR_BASE must use HTTPS.' >&2; exit 1 ;; esac
source="${MDX_DOWNLOAD_SOURCE:-auto}"
case "$source" in auto|github|mirror) ;; *) echo 'MDX_DOWNLOAD_SOURCE must be auto, github, or mirror.' >&2; exit 1 ;; esac

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT HUP INT TERM

manifest=''
if [ "$source" != mirror ] && curl -fL --connect-timeout 10 --max-time 30 -o "$work/latest.json" "$release/latest.json"; then
  manifest="$work/latest.json"
fi
if [ -z "$manifest" ] && [ "$source" != github ] && curl -fL --connect-timeout 10 --max-time 30 -o "$work/latest-mirror.json" "$mirror/$release/latest-mirror.json"; then
  manifest="$work/latest-mirror.json"
fi
[ -n "$manifest" ] || { echo 'No MDX release manifest is reachable.' >&2; exit 1; }

url="$(/usr/bin/plutil -extract "platforms.darwin-$arch.url" raw -o - "$manifest")"
case "$url" in
  https://github.com/neko233-com/mdx/releases/download/*) origin="$url" ;;
  https://ghproxy.net/https://github.com/neko233-com/mdx/releases/download/*) origin="${url#https://ghproxy.net/}" ;;
  *) echo "Unexpected updater URL: $url" >&2; exit 1 ;;
esac

downloaded=0
if [ "$source" != mirror ] && curl -fL --connect-timeout 10 --retry 2 -o "$work/mdx.tar.gz" "$origin"; then
  downloaded=1
fi
if [ "$downloaded" -eq 0 ] && [ "$source" != github ] && curl -fL --connect-timeout 10 --retry 2 -o "$work/mdx.tar.gz" "$mirror/$origin"; then
  downloaded=1
fi
[ "$downloaded" -eq 1 ] || { echo 'The MDX app could not be downloaded.' >&2; exit 1; }

mkdir "$work/extracted"
tar -xzf "$work/mdx.tar.gz" -C "$work/extracted"
[ -d "$work/extracted/MDX.app" ] || { echo 'The release did not contain MDX.app.' >&2; exit 1; }
mkdir -p "$HOME/Applications"
/usr/bin/ditto "$work/extracted/MDX.app" "$HOME/Applications/MDX.app"
desktop_app="$HOME/Desktop/MDX.app"
mkdir -p "$HOME/Desktop"
if [ -L "$desktop_app" ]; then
  if [ "$(readlink "$desktop_app")" != "$HOME/Applications/MDX.app" ]; then
    echo "Leaving existing desktop link at $desktop_app unchanged." >&2
  fi
elif [ -e "$desktop_app" ]; then
  echo "Leaving existing desktop item at $desktop_app unchanged." >&2
else
  ln -s "$HOME/Applications/MDX.app" "$desktop_app"
fi
cli="$HOME/Applications/MDX.app/Contents/MacOS/mdx-cli"
if [ -x "$cli" ]; then
  mkdir -p "$HOME/.local/bin"
  link="$HOME/.local/bin/mdx"
  if [ ! -e "$link" ] && [ ! -L "$link" ]; then
    ln -s "$cli" "$link"
  fi
  case "${SHELL:-}" in
    */zsh) profile="$HOME/.zprofile" ; path_line='export PATH="$HOME/.local/bin:$PATH"' ;;
    */bash) profile="$HOME/.bash_profile" ; path_line='export PATH="$HOME/.local/bin:$PATH"' ;;
    */fish) profile="$HOME/.config/fish/config.fish" ; path_line='fish_add_path $HOME/.local/bin' ;;
    *) profile='' ; path_line='' ;;
  esac
  if [ -n "$profile" ]; then
    mkdir -p "$(dirname "$profile")"
    if [ ! -f "$profile" ] || ! grep -Fqx "$path_line" "$profile"; then
      printf '\n%s\n' "$path_line" >> "$profile"
    fi
  fi
fi
open "$HOME/Applications/MDX.app"
echo 'MDX installed in ~/Applications. Open a new terminal for the mdx CLI. Choose MDX as the default Markdown app from Finder > Get Info > Open with.'
