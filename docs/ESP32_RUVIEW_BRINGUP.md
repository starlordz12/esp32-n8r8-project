# RuView ESP32-S3 Flashing and Bring-Up

This guide covers the complete path from an empty ESP32-S3-DevKitC-1-N8R8 to
live CSI packets arriving at the Raspberry Pi 5 base station.

Use the pre-built upstream firmware for the first hardware bring-up. Building
custom firmware adds unnecessary variables before the board, USB path, Wi-Fi,
provisioning, and UDP pipeline are known to work.

## Scope and safety

- Target: ESP32-S3-WROOM-1-N8R8, 8 MB flash and 8 MB Octal PSRAM.
- Host used for flashing: Windows.
- Aggregator: Raspberry Pi 5 configured by
  [PI_BASE_STATION.md](PI_BASE_STATION.md).
- Flash one board at a time.
- Confirm the selected COM port before every erase or write.
- Erasing flash removes all existing firmware and NVS configuration from that
  board.
- Never commit Wi-Fi credentials, provisioning state, COM ports, downloaded
  binaries, or CSI captures.

## 1. Finish the Pi base station first

Complete the Pi guide through its pre-hardware verification section. On the Pi:

```bash
cd /opt/ruview-base/project/deploy/pi
docker compose ps
curl --fail http://localhost:3000/health
sudo ss -lntup | grep -E ':(3000|3001|5005)\b'
```

Record the Pi's router-reserved Ethernet address privately:

```bash
ip -4 -brief address show eth0
```

Every ESP32 will send UDP port `5005` to that address. Do not write the address
into this repository.

## 2. Prepare the Windows flashing environment

### Hardware

- One ESP32-S3 board.
- One known data-capable USB-C cable.
- A direct USB port on the computer; avoid a hub during first bring-up.

The dual USB-C board has a USB-to-UART connector and a native ESP32-S3 USB
connector. Use the connector labelled **UART**, **COM**, or **USB-UART** for the
first flash and serial monitor. Confirm the physical labels when the boards
arrive.

### Python and Git

Install current 64-bit Python 3 and Git for Windows if they are not already
available. In a new PowerShell window:

```powershell
py -3 --version
git --version
```

Create an isolated tool environment outside the project repository:

```powershell
New-Item -ItemType Directory -Force C:\dev\ruview-tools | Out-Null
Set-Location C:\dev\ruview-tools
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install "esptool>=5.0" "esp-idf-nvs-partition-gen>=0.2.0"
python -m esptool version
```

If PowerShell blocks virtual-environment activation, use the environment's
Python directly instead of changing the system execution policy:

```powershell
.\.venv\Scripts\python.exe -m esptool version
```

All later `python` commands assume this environment is active.

## 3. Get a matched RuView firmware release

Open the
[RuView firmware releases](https://github.com/ruvnet/RuView/releases) and choose
the current ESP32 firmware tag documented by the
[upstream user guide](https://github.com/ruvnet/RuView/blob/main/docs/user-guide.md).
At the time this guide was written, that tag was `v0.7.0-esp32`.

Do not use an unrelated automated application release merely because GitHub
labels it "Latest".

For the N8R8 board, download these four **8 MB** assets from the same firmware
release:

```text
bootloader.bin
partition-table.bin
ota_data_initial.bin
esp32-csi-node.bin
```

Also download or clone the source for the same tag because its `provision.py`
must match the firmware:

```powershell
Set-Location C:\dev
git clone --depth 1 --branch v0.7.0-esp32 `
  https://github.com/ruvnet/RuView.git RuView-upstream
```

If the upstream guide names a newer firmware tag, substitute that exact tag in
the clone command. Keep all four binaries and `provision.py` on the same tag.

Create a local firmware directory and place the four downloaded files there:

```powershell
New-Item -ItemType Directory -Force C:\dev\ruview-firmware | Out-Null
Set-Location C:\dev\ruview-firmware
Get-ChildItem *.bin
Get-FileHash *.bin -Algorithm SHA256
```

Before continuing, confirm that exactly the four required files exist and none
has a zero-byte size. Do not use the 4 MB `SuperMini` application or partition
files on these N8R8 boards.

## 4. Identify the USB-to-UART port

With the board disconnected:

```powershell
Get-CimInstance Win32_SerialPort |
  Select-Object DeviceID, Name, PNPDeviceID
```

Connect the board to the USB-to-UART connector and run the command again. The
new device is the port for that board.

Windows may install the driver automatically. If it does not:

1. Inspect the USB bridge name or hardware ID in Device Manager.
2. For a Silicon Labs CP210x bridge, use the
   [official CP210x VCP driver](https://www.silabs.com/software-and-tools/usb-to-uart-bridge-vcp-drivers).
3. If the board uses a CH340/CH343 bridge, obtain the driver from WCH rather
   than installing an unrelated CP210x driver.

Keep the port in a local PowerShell variable. The example deliberately does not
prescribe a machine-specific COM number:

```powershell
$EspPort = Read-Host "Enter the ESP32 USB-to-UART COM port"
```

## 5. Probe the board before writing

With the virtual environment active:

```powershell
python -m esptool --chip esp32s3 --port $EspPort chip-id
python -m esptool --chip esp32s3 --port $EspPort flash-id
```

Stop if:

- esptool identifies a chip other than ESP32-S3;
- the port disappears repeatedly;
- the flash probe does not report an 8 MB-class device; or
- the module shield does not say `ESP32-S3-WROOM-1` and `N8R8`.

If automatic download mode fails, hold **BOOT**, tap **RESET**, release RESET,
then release BOOT and retry. Use a different known data cable before changing
software or drivers.

## 6. Erase and flash the first board

The following command erases the selected board:

```powershell
python -m esptool --chip esp32s3 --port $EspPort erase-flash
```

From the directory containing the four matched binaries:

```powershell
Set-Location C:\dev\ruview-firmware

python -m esptool --chip esp32s3 --port $EspPort --baud 460800 `
  write-flash --flash-mode dio --flash-size 8MB --flash-freq 80m `
  0x0 bootloader.bin `
  0x8000 partition-table.bin `
  0xf000 ota_data_initial.bin `
  0x20000 esp32-csi-node.bin
```

These offsets are the current upstream 8 MB RuView OTA layout. Do not combine
binaries, offsets, or provisioning scripts from different releases.

If `460800` is unreliable, retry at `115200` after confirming the cable and
port. Do not repeatedly erase or change flash modes to guess around a connection
problem.

## 7. Provision the first node

The current upstream provisioning script stores its per-port merge state as
JSON, including the Wi-Fi password. Point it at an explicit temporary directory
and remove that directory after all nodes are configured.

In PowerShell:

```powershell
$PiAddress = Read-Host "Enter the Pi's reserved Ethernet IPv4 address"
$WifiName = Read-Host "Enter the 2.4 GHz Wi-Fi SSID"
$WifiPasswordSecure = Read-Host "Enter the Wi-Fi password" -AsSecureString
$ProvisionState = Join-Path $env:TEMP "ruview-provision-state"
New-Item -ItemType Directory -Force $ProvisionState | Out-Null
```

Convert the password only for the duration of the provisioning process:

```powershell
function Invoke-RuViewProvision {
  param(
    [Parameter(Mandatory)] [int] $NodeId,
    [Parameter(Mandatory)] [int] $TdmSlot,
    [Parameter(Mandatory)] [int] $TdmTotal
  )

  $PasswordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR(
    $WifiPasswordSecure
  )
  try {
    $WifiPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
      $PasswordPtr
    )

    python .\provision.py `
      --port $EspPort `
      --chip esp32s3 `
      --ssid $WifiName `
      --password $WifiPasswordPlain `
      --target-ip $PiAddress `
      --target-port 5005 `
      --node-id $NodeId `
      --tdm-slot $TdmSlot `
      --tdm-total $TdmTotal `
      --state-dir $ProvisionState `
      --reset

    if ($LASTEXITCODE -ne 0) {
      throw "RuView provisioning failed with exit code $LASTEXITCODE"
    }
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($PasswordPtr)
    Remove-Variable WifiPasswordPlain -ErrorAction SilentlyContinue
  }
}
```

Provision node 1 as a one-node system for the first end-to-end test:

```powershell
Set-Location C:\dev\RuView-upstream\firmware\esp32-csi-node
Invoke-RuViewProvision -NodeId 1 -TdmSlot 0 -TdmTotal 1
```

Do not use `--state` while credentials are loaded; it prints the merged state.

## 8. Check the first board's serial output

Reset the board, then open a 115200-baud monitor:

```powershell
python -m serial.tools.miniterm $EspPort 115200
```

Look for:

- normal ESP32-S3 boot;
- the expected RuView firmware version;
- connection to the intended Wi-Fi network;
- the configured node ID;
- the intended target IP and UDP port; and
- CSI capture or packet counters increasing.

Exit miniterm with `Ctrl+]`.

Do not treat displayed breathing, heart-rate, pose, fall, or person-count values
as validated measurements during this connectivity test.

## 9. Prove packets reach the Pi

On the Pi:

```bash
cd /opt/ruview-base/project/deploy/pi
docker compose logs -f --tail=200
```

In another SSH session:

```bash
curl --fail http://localhost:3000/health
curl --fail http://localhost:3000/api/v1/nodes
curl --fail http://localhost:3000/api/v1/sensing/latest
```

If the node does not appear, inspect UDP traffic:

```bash
sudo apt install -y tcpdump
sudo tcpdump -ni eth0 udp port 5005
```

The correct first milestone is:

1. serial output shows the board connected;
2. `tcpdump` sees UDP packets from the ESP32;
3. `/api/v1/nodes` lists node 1; and
4. `/api/v1/sensing/latest` changes over time.

Only after those four checks should the browser dashboard be debugged:

- `http://ruview-base.local:3000/ui/index.html`
- `http://ruview-base.local:3000/ui/observatory.html`

## 10. Add all five nodes

Flash each board one at a time with the same four firmware binaries. Give every
board a unique ID and TDM slot:

| Physical label | Node ID | TDM slot | TDM total |
| --- | ---: | ---: | ---: |
| Node 1 | 1 | 0 | 5 |
| Node 2 | 2 | 1 | 5 |
| Node 3 | 3 | 2 | 5 |
| Node 4 | 4 | 3 | 5 |
| Node 5 | 5 | 4 | 5 |

After the single-node test passes, re-provision node 1 with `--tdm-total 5`.
For each board, pass the full Wi-Fi trio, Pi address, node ID, slot, and total.
Do not depend on state from a previous board or COM-port assignment.

Example for node 2:

```powershell
Invoke-RuViewProvision -NodeId 2 -TdmSlot 1 -TdmTotal 5
```

Add one node, verify it appears in `/api/v1/nodes`, then continue. Label each
physical board with its node ID before disconnecting it.

After all boards are provisioned, remove the temporary plaintext state:

```powershell
Remove-Item -LiteralPath $ProvisionState -Recurse
Remove-Item Function:\Invoke-RuViewProvision
Remove-Variable WifiPasswordSecure, WifiName, PiAddress, EspPort, ProvisionState
```

This removal is intentional because the upstream state JSON contains the Wi-Fi
password. Future changes can be made by supplying the full configuration again.

## 11. Initial placement and evidence stages

Bring the system up in increasing difficulty:

1. One node, same room, unobstructed.
2. Three nodes, same room, stable positions.
3. Five nodes, same room, unique TDM slots.
4. Labeled presence and motion trials.
5. Only then, controlled wall-separated trials.

For every experiment record:

- node positions and orientations;
- router/access-point position and channel;
- wall material and thickness;
- distance;
- timestamped ground truth;
- firmware and server versions; and
- raw data-retention decision.

Simulation or a changing dashboard is not proof of sensing accuracy. Through-wall
claims require repeatable labeled measurements, false-positive/negative counts,
and a documented test layout.

## 12. Troubleshooting order

Work from the bottom of the stack upward:

1. **Power/cable:** stable board power and data-capable cable.
2. **USB bridge:** correct driver and stable COM port.
3. **ROM communication:** `chip-id` and `flash-id`.
4. **Firmware:** successful write at the documented offsets.
5. **Serial boot:** correct firmware version and no reset loop.
6. **Wi-Fi:** connected to the intended 2.4 GHz network.
7. **Network:** Pi address reachable and UDP `5005` arriving.
8. **Server:** container healthy and node listed.
9. **UI:** browser connects to the Pi-hosted UI.
10. **Sensing:** controlled calibration and labeled experiments.

Changing multiple layers at once makes failures much harder to isolate.

## Primary references

- [RuView ESP32 firmware guide](https://github.com/ruvnet/RuView/blob/main/firmware/esp32-csi-node/README.md)
- [RuView user guide](https://github.com/ruvnet/RuView/blob/main/docs/user-guide.md)
- [Espressif esptool installation](https://docs.espressif.com/projects/esptool/en/latest/esp32/installation.html)
- [Espressif esptool ESP32-S3 commands](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/esptool/basic-commands.html)
- [Silicon Labs CP210x VCP driver](https://www.silabs.com/software-and-tools/usb-to-uart-bridge-vcp-drivers)

