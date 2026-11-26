#!/usr/bin/env bash
# =====================================================================
# SupportHub Group 12 - prepare a fresh Ubuntu/Debian VM as the remote Floci host.
# Run ON THE VM as a sudo-capable user:   sudo bash install-remote-host.sh
# Idempotent: safe to run again. Changes only system packages/settings listed below.
#
#  1. Docker Engine + compose plugin from Docker's official apt repository
#  2. Node.js (distribution package) - used by the deploy scripts for JSON rendering
#  3. Swap file (2 GB) when the VM has < 2 GB RAM (e.g. free e2-micro, 1 GB)
#  4. Firewall (ufw): deny all incoming except SSH; allow outgoing
#     (Cloudflare Tunnel is outbound-only, Floci publishes no ports)
#  5. Unattended security upgrades
#  6. Docker log rotation (10 MB x 3 per container) to protect the small disk
#  7. Adds the invoking user to the docker group
# =====================================================================
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 2; }
. /etc/os-release
case "$ID" in ubuntu|debian) ;; *) echo "unsupported OS $ID (Ubuntu/Debian expected)"; exit 2 ;; esac
TARGET_USER="${SUDO_USER:-$(logname 2>/dev/null || echo root)}"
step() { echo; echo "==> $1"; }

step "Base packages"
apt-get update -y -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl gnupg ufw unattended-upgrades nodejs openssl >/dev/null

step "Docker Engine (official repository)"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
systemctl enable --now docker >/dev/null
docker --version; docker compose version

step "Docker log rotation"
if [ ! -f /etc/docker/daemon.json ]; then
  printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "10m", "max-file": "3" }\n}\n' > /etc/docker/daemon.json
  systemctl restart docker
  echo "daemon.json written"
else
  echo "existing /etc/docker/daemon.json kept (not modified)"
fi

step "Swap (only when RAM < 2 GB)"
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 2000 ] && ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "2 GB swap enabled (RAM ${MEM_MB} MB)"
else
  echo "RAM ${MEM_MB} MB - swap unchanged"
fi

step "Firewall: deny incoming except SSH"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw --force enable >/dev/null
ufw status verbose | sed 's/^/  /'
echo "  NOTE: Docker-published ports bypass ufw; the SupportHub compose file publishes NONE."

step "Unattended security upgrades"
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true
echo "  enabled"

step "docker group for $TARGET_USER"
if [ "$TARGET_USER" != root ]; then usermod -aG docker "$TARGET_USER"; echo "  added (log out and in again)"; fi

step "Summary"
echo "  OS: $PRETTY_NAME, arch $(dpkg --print-architecture), RAM ${MEM_MB} MB, CPUs $(nproc), free disk $(df -h / | awk 'NR==2{print $4}')"
echo "  Listening TCP sockets (should be SSH only):"
ss -tlnH | awk '{print "   ", $4}'
