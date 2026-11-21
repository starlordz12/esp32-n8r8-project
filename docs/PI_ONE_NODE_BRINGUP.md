# Raspberry Pi 5 one-node bring-up

This runbook proves one complete, local-only path before more nodes are added:

`ESP32-S3 -> UDP 5005 -> pinned RuView server -> dashboard adapter -> browser`

The procedure deliberately keeps the RuView HTTP and WebSocket ports on the Pi's
loopback interface. Only the dashboard on TCP 8080 and ESP32 ingest on UDP 5005
are exposed to the portable LAN. Do not forward these ports to the internet.

## 1. Prepare the Pi

Use a Raspberry Pi 5 with Raspberry Pi OS Lite 64-bit, Ethernet to the portable
router, a reserved LAN address, adequate cooling, and the official 27 W USB-C
power supply. Raspberry Pi Imager can preconfigure the hostname, user, and SSH
for a headless install. See the official [getting started guide][pi-start] and
[Raspberry Pi 5 power guidance][pi5-power].

Install Docker Engine from Docker's official Debian repository. Raspberry Pi OS
currently follows Debian, and Docker documents arm64 packages for supported
Debian releases in its [Debian installation guide][docker-debian]. Run these
commands on the Pi:

```bash
sudo apt update
sudo apt install -y ca-certificates curl jq git openssl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
printf '%s\n' \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $VERSION_CODENAME stable" |
  sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo docker run --rm hello-world
```

Docker-published ports can bypass some host firewall rules. Keep the bind
addresses in this repository's `.env.example`, and use the router to isolate the
portable LAN rather than assuming a host firewall makes published ports private.

## 2. Start the pinned local stack

Clone this repository on the Pi, then work from `deploy/pi`:

```bash
cd deploy/pi
umask 077
cp .env.example .env
chmod 600 .env
sed -i '/^RUVIEW_API_TOKEN=/d' .env
printf 'RUVIEW_API_TOKEN=' >>.env
openssl rand -hex 32 >>.env
sudo docker compose pull sensing-server
sudo docker compose build --pull dashboard
sudo docker compose up -d
sudo ./verify.sh
```

The first verification should pass even with no ESP32 connected; the dashboard
will honestly report a preview/waiting/offline state. Keep `.env` private and
never paste its token into logs, issue reports, or Git.

Open `http://<pi-lan-address>:8080` from a device on the same isolated LAN. The
raw server ports are intentionally unavailable from other devices.

## 3. Build and validate firmware

On the Windows development machine, start Docker Desktop and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Build-RuView.ps1
```

The build creates an ignored artifact directory containing four binaries,
`flash-manifest.json`, and `SHA256SUMS.txt`. The script verifies the exact pinned
commit, reviewed offsets, file names, and hashes before returning success.

Install Python 3.10+ and the upstream provisioning requirements on the
development machine:

```powershell
py -3 -m pip install "esptool>=5.0" esp-idf-nvs-partition-gen
```

## 4. Flash exactly one node

Connect only the board being tested through its `COM` USB-C connector. Capture
the machine-specific serial port interactively so it is not placed in tracked
files or command history:

```powershell
$serialPort = Read-Host 'Serial port'
.\scripts\Flash-RuView.ps1 -Port $serialPort
```

The helper verifies the artifact manifest and hashes, probes the chip, then asks
for confirmation before writing. It does not erase flash unless `-EraseFirst` is
explicitly supplied. Preserve the verified factory backup outside Git.

## 5. Provision Wi-Fi and UDP target

Record the Pi's reserved IPv4 address and the portable router SSID locally. Then
run the provisioning helper; it prompts for the Wi-Fi password as a secure value,
does not put that password in the child process argument list, and deletes its
temporary state after completion:

```powershell
$piAddress = Read-Host 'Pi reserved IPv4 address'
$wifiName = Read-Host 'Portable router Wi-Fi name'
.\scripts\Provision-RuViewNode.ps1 `
  -Port $serialPort `
  -Ssid $wifiName `
  -AggregatorAddress $piAddress `
  -NodeId 1 `
  -TdmSlot 0 `
  -TdmTotal 1
```

The configuration fixes the target to UDP 5005. Give every future board a
different node ID, but do not scale yet.

## 6. Prove the end-to-end path

Monitor the node manually at 115200 baud. Confirm its configured node ID, Wi-Fi
connection, and CSI streaming without saving credentials or serial logs in this
repository. In a second Pi shell, temporarily observe packet arrival:

```bash
sudo tcpdump -ni any udp port 5005
```

Stop `tcpdump` after packets are visible, then run the strict check:

```bash
cd deploy/pi
sudo ./verify.sh --expect-live
```

Success requires the reviewed server image, healthy JSON endpoints, RuView's
ESP32 source (not simulation or offline cache), a live dashboard state, and at
least one normalized node. This verifies transport and presentation readiness;
it is not an accuracy or calibration claim.

## 7. Soak, then scale

Leave the single node running through a representative session. Watch container
state with `sudo docker compose ps` and inspect targeted logs only when needed
with `sudo docker compose logs --tail=100 <service>`. After the path remains
stable, repeat flash/provision for one board at a time with a unique node ID and
an appropriate TDM slot/total.

[docker-debian]: https://docs.docker.com/engine/install/debian/
[pi-start]: https://www.raspberrypi.com/documentation/computers/getting-started.html
[pi5-power]: https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#power-supply
