# Raspberry Pi 5 Base Station

This guide configures a Raspberry Pi 5 (8 GB) as the always-on aggregation
server for the ESP32-S3 CSI nodes. The Pi receives ADR-018 CSI datagrams over
UDP, runs the RuView sensing server, and serves the local dashboard.

## Recommended configuration

| Item | Choice |
| --- | --- |
| Computer | Raspberry Pi 5, 8 GB |
| Operating system | Raspberry Pi OS Lite (64-bit), Debian Trixie |
| Network | Gigabit Ethernet to the router |
| Storage | 256-512 GB NVMe preferred; high-endurance microSD is acceptable initially |
| Cooling | Raspberry Pi Active Cooler or the official fan case |
| Power | Raspberry Pi 27 W USB-C power supply |
| Runtime | Docker Engine with Docker Compose |
| Hostname | `ruview-base` |
| Sensor input | UDP port `5005` |
| Dashboard | TCP port `3000` |
| WebSocket | TCP port `3001` |

Use the Pi as the wired processing server. Keep the ESP32 nodes on the same
router's 2.4 GHz Wi-Fi network. Do not make the Pi's onboard Wi-Fi serve as the
access point during initial bring-up; a normal router gives a simpler and more
repeatable RF and network environment.

## 1. Assemble the Pi

1. Disconnect all power.
2. Install the Active Cooler before installing a full-size M.2 HAT+.
3. If using NVMe, install the M.2 HAT+ and SSD according to Raspberry Pi's
   instructions.
4. Connect Gigabit Ethernet to the router.
5. Connect the official 27 W supply only after the boot media is ready.

Keep PCIe at its supported Gen 2 setting. Gen 3 is not required by this project
and is not certified by Raspberry Pi.

## 2. Install the operating system

On the Windows computer, install
[Raspberry Pi Imager](https://www.raspberrypi.com/software/).

In Imager:

1. **Device:** Raspberry Pi 5.
2. **OS:** Raspberry Pi OS (other) -> Raspberry Pi OS Lite (64-bit).
3. **Storage:** select the microSD card or an NVMe drive connected through a USB
   enclosure.
4. Open OS customisation and set:
   - Hostname: `ruview-base`
   - Username: a personal lowercase admin name; do not use the historical
     default `pi`
   - A unique password
   - Correct locale, keyboard, and `America/Chicago` time zone
   - Enable SSH
   - Prefer SSH public-key authentication; password authentication is acceptable
     only for first setup
   - Wi-Fi can be configured as an emergency fallback, but Ethernet is primary
5. Confirm the selected target carefully, then write and verify the image.

Imaging erases the selected storage device.

### NVMe choices

- **Best:** image the NVMe directly using a USB NVMe enclosure, install it on the
  M.2 HAT+, remove the microSD card, and boot.
- **Simplest start:** boot from microSD now and re-image the NVMe cleanly later.
  Keep configuration in Git so the base station is reproducible instead of
  depending on a cloned system disk.

If an imaged NVMe does not boot, boot from microSD, update the OS and EEPROM, and
select `Advanced Options -> Boot Order -> NVMe/USB boot` in `sudo raspi-config`.

## 3. First boot and SSH

Power on the Pi and wait two or three minutes. From PowerShell on Windows:

```powershell
ssh YOUR_USERNAME@ruview-base.local
```

If mDNS does not resolve, find the Pi's address in the router's client list and
use:

```powershell
ssh YOUR_USERNAME@192.168.1.123
```

Do not copy the example address into configuration; use the address assigned by
the router.

Verify the platform:

```bash
uname -m
grep -E '^(PRETTY_NAME|VERSION_CODENAME)=' /etc/os-release
hostnamectl
timedatectl
```

Expected architecture is `aarch64`; the OS should report Raspberry Pi OS based
on Debian Trixie.

## 4. Reserve the Pi's network address

In the router's administration page, create a DHCP reservation for the Pi's
wired Ethernet MAC address. This is the address every ESP32 node will use as its
UDP target.

Find the address and MAC with:

```bash
ip -brief address show eth0
cat /sys/class/net/eth0/address
```

Prefer a router-side DHCP reservation over manually hard-coding an address in
Raspberry Pi OS. Record the final address in a private deployment note, not in
Git.

## 5. Update and check the base system

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y ca-certificates curl git jq
sudo rpi-eeprom-update -a
sudo reboot
```

Reconnect over SSH, then check power, temperature, storage, and networking:

```bash
vcgencmd get_throttled
vcgencmd measure_temp
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS,MODEL
findmnt /
ip -brief address
```

`get_throttled=0x0` is the healthy result. Investigate undervoltage or thermal
flags before installing the sensing stack.

## 6. Install Docker Engine

Raspberry Pi OS 64-bit uses Docker's supported Debian `arm64` packages. Install
from Docker's signed apt repository:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker
```

Log out and reconnect so group membership takes effect:

```bash
exit
```

Reconnect over SSH and verify:

```bash
docker version
docker compose version
docker run --rm hello-world
```

Membership in the `docker` group grants root-equivalent control of the host.
Only trusted administrator accounts should receive it.

## 7. Install the base-station deployment

Clone this public repository into `/opt`:

```bash
sudo install -d -o "$USER" -g "$USER" /opt/ruview-base
git clone https://github.com/starlordz12/esp32-n8r8-project.git \
  /opt/ruview-base/project
cd /opt/ruview-base/project/deploy/pi
cp base-station.env.example .env
```

The `.env` file is intentionally ignored by Git. Do not put Wi-Fi credentials,
API tokens, addresses, or other local secrets into tracked files.

Pull and start the ARM64 RuView sensing server:

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100
```

The Compose configuration forces the real ESP32 source. It does not silently
fall back to simulation when no nodes are online.

## 8. Verify the server before hardware arrives

On the Pi:

```bash
curl --fail http://localhost:3000/health
curl --fail http://localhost:3000/api/v1/nodes
docker compose ps
sudo ss -lntup | grep -E ':(3000|3001|5005)\b'
```

From PowerShell on Windows:

```powershell
curl.exe http://ruview-base.local:3000/health
```

Open these in a browser:

- `http://ruview-base.local:3000/ui/index.html`
- `http://ruview-base.local:3000/ui/observatory.html`

No ESP32 data is expected yet. A healthy server with zero live nodes is the
correct pre-hardware state.

## 9. Verify automatic recovery

The Docker service starts at boot and the container uses
`restart: unless-stopped`. Test the complete path:

```bash
sudo reboot
```

After the Pi returns:

```bash
docker ps
curl --fail http://localhost:3000/health
```

Unplugging power is not a normal shutdown test. Use `sudo poweroff`, wait for
activity LEDs to stop, and then remove power.

## 10. Connect the ESP32 nodes

When the boards arrive:

1. Confirm the module shield says `ESP32-S3-WROOM-1` and `N8R8`.
2. Flash and provision one board at a time over its USB-to-UART port.
3. Give every board a unique node ID.
4. Connect every node to the same 2.4 GHz Wi-Fi network.
5. Set every node's target IP to the Pi's reserved Ethernet address.
6. Set the target UDP port to `5005`.
7. Confirm one node end-to-end before adding the rest.
8. Add nodes one at a time and verify `/api/v1/nodes` after each addition.

Normal sensing traffic is wireless. USB is needed for flashing, provisioning,
and serial diagnostics, not for permanent operation.

## 11. Routine operations

Status and logs:

```bash
cd /opt/ruview-base/project/deploy/pi
docker compose ps
docker compose logs -f --tail=200
```

Update the project and container:

```bash
cd /opt/ruview-base/project
git pull --ff-only
cd deploy/pi
docker compose pull
docker compose up -d
curl --fail http://localhost:3000/health
```

Storage checks:

```bash
df -h /
docker system df
```

Do not run unattended Docker cleanup commands. Review images, containers, and
recordings before deleting anything.

## 12. Security boundaries

- Do not forward ports `3000`, `3001`, or `5005` through the internet router.
- Keep the Pi and sensors on a trusted LAN or an isolated sensor VLAN.
- Prefer SSH keys; after confirming key login, disable SSH password
  authentication.
- Never commit the deployment `.env`, Wi-Fi credentials, tokens, router
  addresses, serial ports, or raw household CSI captures.
- Treat CSI recordings as potentially sensitive occupancy data.
- For remote access later, use a private VPN such as Tailscale instead of router
  port forwarding.
- RuView supports optional `RUVIEW_API_TOKEN` protection for API routes, but
  first verify the local dashboard without it because browser clients must also
  be configured to send the token.

## Acceptance checklist

- [ ] Raspberry Pi OS Lite 64-bit boots from the intended device
- [ ] `uname -m` reports `aarch64`
- [ ] Ethernet DHCP reservation is configured
- [ ] `vcgencmd get_throttled` reports `0x0`
- [ ] Docker and Compose work without `sudo`
- [ ] RuView ARM64 image starts
- [ ] Health endpoint responds
- [ ] Dashboard opens from another LAN device
- [ ] TCP `3000` and `3001`, and UDP `5005`, are listening
- [ ] Container returns after a controlled reboot
- [ ] No project ports are forwarded from the internet

## Primary references

- [Raspberry Pi OS documentation](https://www.raspberrypi.com/documentation/computers/os.html)
- [Raspberry Pi headless setup](https://www.raspberrypi.com/documentation/computers/getting-started.html)
- [Raspberry Pi M.2 HAT+ documentation](https://www.raspberrypi.com/documentation/accessories/m2-hat-plus.html)
- [Docker Engine on Debian](https://docs.docker.com/engine/install/debian/)
- [RuView user guide](https://github.com/ruvnet/RuView/blob/main/docs/user-guide.md)

