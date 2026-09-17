# TSRun

Try it live: <https://josef-jelinek.github.io/TSRun/>

TSRun is a browser emulator for the Timex Sinclair 2068. It loads default
HOME ROM and EXROM from `roms/` when those files are available.
Both ULA beeper and AY-3-8912 are supported. However, the browser may stay
silent until a click or key as it suspends autoplay audio by default.

No build, package manager, or external library is required. The pages are
plain JavaScript. `tsconfig.json` is only for optional static checking during
development (`tsc --noEmit` or `npx --yes tsc --noEmit`). ES modules cannot
be loaded from `file://`, so serve the repository root with a static file
server and open `index.html` in a modern browser. From the project directory:

```text
go run server.go
```

or:

```text
python3 -m http.server
```

Either command accepts an optional port; the default is 8000:

```text
go run server.go 8080
python3 -m http.server 8080
```

Then visit `http://127.0.0.1:8000/` (or the port you chose).

The machine starts with HOME and EXROM filled with zeros, then tries
`roms/<name>-0.rom` (16K) and `roms/<name>-1.rom` (8K). The default `<name>` is
`ts2068`. Use `?rom=leap` for the experimental Leap ROMs. `?rom=ts2068` is the
same as omitting the parameter. With the bundled ROMs the copyright screen
should appear within about a second. If a ROM fetch fails, **Load ROM0** /
**Load ROM1** still accept a raw 16K HOME and 8K EXROM `.rom` or `.bin` file.

The UI switches can also be initialized through URL parameters. Use `0` to
disable a switch and `1` to enable it. Missing or invalid parameters keep the
normal defaults:

| Parameter | Default |
| --- | --- |
| `keyboard` | `0` |
| `crt` | `1` |
| `stereo` | `0` |
| `auto` | `1` |
| `turbo` | `1` |

For example, `?crt=0&turbo=0&keyboard=1&auto=0` starts with the CRT filter,
turbo loading, and tape autoload disabled and the onscreen keyboard shown.
These parameters can be combined with `rom`; changing switches after startup
does not change the URL. Fullscreen is not exposed as a URL parameter.

## Emulator page

`index.html` is the standalone emulator. A TAP, TZX, DCK, or ZIP file can be
fetched and loaded at startup with the `url` parameter. Encode the file URL
with `encodeURIComponent`, especially if it has its own query parameters:

```text
?url=https%3A%2F%2Fexample.com%2Fgame.tap
?url=https%3A%2F%2Fexample.com%2Fgame.dck
```

Cross-origin URLs must allow the browser to read them through CORS. Tape files
are inserted after the ROM fetch finishes, whether it succeeds or fails; the
Auto switch still determines whether the bundled ROMs enter their tape loader
immediately. DCK files are
inserted and booted through a reset. A tape loaded this way does not unplug a
cartridge; dock memory stays mapped so a cart and a tape can be used together.

For a ZIP, the alphabetically first usable TAP, TZX, or DCK member is loaded.
Hidden files, macOS resource forks, encrypted members, and unsupported
compression are ignored. Add the exact, case-sensitive full member path as a
URL fragment in the `url` parameter to select a different member:

```text
?url=https%3A%2F%2Fexample.com%2Fgames.zip%23folder%2Fgame.tzx
```

The ZIP can use stored or deflate compression; ZIP64 and multi-disk archives are
not supported. `zip.js` inflates that archive in the page. The archive browser
does not use it: it fetches unpacked members instead. archive.org ZIP files
have no CORS; a `#member` fragment on those URLs is fetched as an unpacked
file rather than as a ZIP.

### Command bar

- Reset - restart the Z80 at address 0. A tape is kept at its current block,
  which restarts from its leader, and EAR playback pauses until a loader is
  waiting again. A cartridge is kept and the ROM probes it again (autostart
  carts re-run).
- NMI - pulse the Z80 NMI pin (`PC=0x0066`). The stock ROM returns immediately;
  a program that installed an NMI handler will run it.
- Keyboard - show or hide the TS 2068 keyboard under the screen (also F1).
- CRT - fit the display continuously and add rounded pixels, horizontal color
  bleed and scanlines. When off, the display is unfiltered integer-scaled.
- Stereo - spread the three AY channels across the stereo image. Off by
  default, since the machine mixes everything into one mono output.
- Fullscreen - show only the fullscreen emulator canvas (also F11).
- Load Tape - insert a `.tap` or `.tzx`. Playback starts when the stock ROM
  loader or a tight custom EAR polling loop is detected, so the header is not
  missed. With Auto off, at the `K` cursor press J (`LOAD`), then `""` and
  Enter. Border bars still show while the block loads. TZX
  supports standard, turbo, pulse, pure-data, direct-recording, pause, stop,
  signal-level, and control-flow blocks, with loops and jumps followed as the
  tape plays; CSW, generalized-data, and Select blocks are rejected. A
  cartridge already in the dock is left mapped.
- Auto - when checked (the default), reset the bundled TS2068 ROMs directly
  into their tape loader when a tape is selected. With custom ROMs or a
  cartridge inserted, Auto leaves the machine running and falls back to normal
  loader detection or Play.
- Play - manually start a ready tape, or resume after a TZX stop block. This is
  a fallback for loading routines whose EAR access pattern cannot be detected.
- Turbo - on the tape row. When checked (the default), CPU and tape run many
  times faster than realtime while the tape is playing, including TZX pauses.
  Uncheck for ROM-speed playback with the leader tone. T-state custom loaders
  warp as well; this is not an instant ROM poke. Warped frames are not drawn
  or mixed. After each burst the frames the tape landed on are painted and
  mixed, as many as the audio queue has room for, so the loader stays audible
  as a run of snippets while the tape warps past.
- Load Cart - insert a `.dck` dock image and reset so the ROM can autostart
  LROS/AROS. Extra 8K chunks are paged by the program with `OUT 244`.
- Eject - on the cartridge row, after Load Cart. Unplugs the cartridge, restores any
  HOME-bank RAM pages the image overwrote, and resets so the ROM no longer
  sees dock memory.
- Load ROM0 - replace the 16K HOME ROM from a `.rom` / `.bin` file and reset.
- Load ROM1 - replace the 8K EXROM the same way.

Reset does not eject a tape or cartridge. After Eject, or with no cartridge, the
ROM should return to the copyright start screen.

Host keys always reach the emulator on this page (F1 and F11 are the page
shortcuts). The archive page is different: keys reach the emulator only while
the screen is focused.

## Archive browser

`archive.html` is a second page: the [Timex Sinclair Software Archive](https://archive.org/details/timex-sinclair-software-archive) on the left and the emulator on the right. There are no local tape, cartridge, or ROM pickers, and no NMI or Eject controls.

The list starts as first-letter buckets of the ZIP titles (case-insensitive). A search field above the list filters those titles as you type (case-insensitive substring). With a query entered, matching ZIPs are listed directly, skipping the letter buckets. Opening a ZIP shows every member; the search does not filter inside the archive. The **TS2068** switch next to the field is on by default and keeps only titles tagged for the TS 2068; turn it off to show the whole archive with no machine filter. `?ts2068=0` starts with that switch off. Open a letter, then a ZIP, then a TAP, TZX, or DCK. TAP, TZX, and DCK members are shown in the accent color. `..` goes up one level. A mouse click highlights a row; a later click on that same row opens it. Arrow keys, Page Up/Down, Home, End, and Enter navigate when the list is focused. The same arrows, Page Up/Down, and Enter work while the search field is focused; Enter also moves focus to the list. Host keys reach the emulator only while the screen is focused; that is intentional, so list navigation does not type into the machine. Members are fetched from archive.org's unpacked download URLs (those allow CORS). The ZIP bytes themselves are not downloaded, and `zip.js` is not used on this page.

The top path follows the list cursor: the current ZIP (and folder) in the normal text color, then a TAP, TZX, or DCK name in the accent color. It updates as you move, including over a file that has not been loaded yet. **Open in TSRun** and **Download** sit on the right of the options bar. Download is shown for a highlighted ZIP or any file inside one. Open in TSRun appears when the cursor is on a TAP, TZX, or DCK and links to `index.html?url=` with the ZIP URL and a `#member` fragment, encoded the same way as the emulator page's `url` parameter:

```text
index.html?url=https%3A%2F%2Farchive.org%2Fdownload%2Ftimex-sinclair-software-archive%2Fgame.zip%23folder%2Fgame.tzx
```

Reset, Keyboard, CRT, Stereo, Fullscreen, Auto, Turbo, and Play sit in the bar above the path and mean the same as on `index.html`. Tape and sound status sit in a bar above the on-screen keyboard. Drag the divider between the list and the emulator to resize them. The same `keyboard`, `crt`, `stereo`, `auto`, `turbo`, and `rom` URL parameters as the emulator page apply; `ts2068` is archive-only.

Selecting a tape ejects any cartridge first, then inserts the tape, so Auto can enter the bundled ROM loader. That differs from `index.html` on purpose: the emulator page keeps dock memory when a tape is loaded. If a cartridge was mapped and Auto does not run, the machine is reset after the eject.

## Sound

The SCLD speaker/tape output (port `FE` bits 3 and 4) and the AY-3-8912
(ports `F5`/`F6`) are mixed in the browser. The SCLD exclusive-ors tape-output
bit 3 and beeper bit 4 into the single signal present on the real machine's
`SPKR/TAPE OUT` pin. A click or key may be required before anything is audible.
The machine runs at 60.1145 Hz. Two to three video frames of samples are kept
queued: the audio thread asks for one more whenever the queue falls below two,
and the machine runs a frame only once a frame has been played. Emulation
therefore keeps the audio device's pace rather than the display's, which is what
stops a refresh rate that does not divide into 60.1145 Hz from running the
machine fast. Two frames of slack absorb a late refresh or a collection pause;
the cost is that `BEEP` and tape edges are heard about 35 ms late.

The status line beside the tape info reports what that is doing, once a second:
emulated frames per second, then audio an overrun discarded and silence an
underrun had to fill. At speed it reads about `60.1 fps, cut 0 ms, gap 0 ms`;
frames per second well above 60.1 means the frame loop is running the machine
too fast, and a standing cut or gap means production and playback have drifted
apart.

Both sources are integrated on the CPU clock. The AY runs on its own tick grid
(one tick per 16 T-states) rather than on the output sample rate, and every
beeper edge, AY register write and tape edge is applied at the exact T-state it
happens. The main-board amplifier's 680 kOhm/20 pF feedback low-pass (about
11.7 kHz) is integrated in emulated time before PCM sampling, then each output
sample is the time-weighted average over its window. This attenuates edges before
they can alias and keeps an envelope retrigger at the T-state where the program
put it. The tied AY outputs and SCLD output are weighted by their schematic
47 kOhm and 100 kOhm input resistors. The mix is then AC coupled by a 20 Hz
one-pole, as the speaker and the TV audio input are: the chips put out unipolar
levels, and without it a voice falling silent steps the output by its own offset
instead of returning to rest.
`BEEP` uses the ULA; `SOUND register,value` talks to the AY. Tape EAR is mixed
quietly so loading can be heard; this monitor is an emulator convenience rather
than part of the amplifier path. The machine sums the three AY channels and the
beeper into one analog output, so the default here is mono as well. The Stereo
switch spreads the AY channels ABC across the image, which makes individual
voices easier to pick out. Both mixes carry the same total signal, so switching
between them does not change the level.

## Keyboard

The host keyboard is mapped onto the TS 2068 8x5 matrix (port `FE`). Letters
and digits match the keycaps. Both Shift keys are Caps Shift; both Ctrl keys
are Symbol Shift.

On `index.html`, those host keys always reach the emulator. On `archive.html`,
they reach the emulator only while the screen is focused. When the archive
list is focused, Arrow keys, Page Up/Down, Home, End, and Enter move in the
list instead. F1 and F11 stay page shortcuts on both pages.

Extra mappings:

- Backspace / Delete - Caps Shift + 0
- Arrow keys - Caps Shift + 5/6/7/8
- Escape - BREAK (Caps Shift + Space); or exit full-screen mode
- Tab - EDIT (Caps Shift + 1)
- `.` `,` `;` `"` `-` `=` `/` - the usual Symbol Shift pairs

**F1** or the Keyboard switch shows or hides the original TS 2068 keyboard
(`keyboard.png`) under the screen. The emulator display scales to the remaining
space. Overlay keys can be clicked; they invert when the matching matrix bits
are down.

**F11** or the Fullscreen button makes the page fullscreen with only the
emulator canvas (4:3, integer scaled). Escape or F11 again restores the header.

## Joysticks

The two joystick ports are read through I/O port A of the AY-3-8912, not through
the key matrix. A program selects AY register 14 by writing `14` to port `F5`,
then reads port `F6` with the player number in `B`, since address bit 8 strobes
the left stick and bit 9 the right. Data is active low: bits 0-3 are up, down,
left and right, bit 7 is the button, and the rest read as 1.

Both ports are driven by host gamepads through the browser Gamepad API, polled
once per animation frame. The first two connected pads become player 1 and
player 2 whichever slots they occupy, so a single pad always drives player 1. A
direction is on when the matching d-pad button is down or the left stick is
pushed past halfway, and any face or shoulder button is the fire button. A
browser only reports a pad once it has been used, so press one of its buttons
first if nothing responds.

## Display

The visible picture is the SCLD output: 256x192 paper (512x192 in hi-res) with
a border, integer-scaled to a 4:3 rectangle in the window.

The optional CRT mode fills the available 4:3 area and renders at the physical
display resolution. It adds restrained horizontal color bleed and scanlines,
without distortion, chromatic aberration, bloom, noise or a vignette.

The picture is drawn by following the beam rather than by grabbing the display
file once per frame. The raster is free-running at 224 T-states per line and
262 lines per frame (exactly the 58688 T-states of one 60.1145 Hz frame), and
one T-state is two pixels. Anything the raster reads - the border, the port `FF`
mode, screen memory, attributes - is sampled at the position the beam has
reached, so mid-frame changes split the screen the way they do on hardware.
Writes to display memory need no special handling: the beam only paints the
past, so a write ahead of it is picked up when the beam arrives. Port `FF` bits 2-0
select the screen mode (`OUT 255,n` from BASIC):

- `0` - screen 0 at `0x4000` / attrs `0x5800` (Spectrum 256x192, 8x8 attributes).
- `1` - screen 1, same format at `0x6000` / `0x7800`.
- `2` - hi-color: pixels from screen 0, 8x1 attributes from the matching byte
  in screen 1 (`addr + 0x2000`, same Y encoding as the bitmap).
- `6` - hi-res 512x192, two colors. Even 8-pixel columns from screen 0, odd
  from screen 1. Ink/paper (and the border) come from bits 5-3, with bright and
  flash fixed off by the SCLD; `OUT 255,6` is black on white.

Stock BASIC still prints to screen 0. Hi-color and hi-res reuse `0x6000`-`0x7AFF`,
where the ROM keeps a RAM copy of the OS, so those modes need machine code that
moves the stack and system variables first.

The start screen is white paper, white border, and two copyright lines at the
bottom. During tape load the ROM changes the border on each EAR edge, which the
beam renders as bars that break mid-line, as on hardware. Bit 6 of port `FF` inhibits the frame interrupt.

## Repository files

- `README.md` - project overview and user documentation.
- `app.css` - shared controls, keyboard overlay, and base chrome for both pages.
- `index.html` - emulator page markup and page-specific styles.
- `main.js` - emulator page: local tape, cart, and ROM pickers, and `?url=` loading.
- `archive.html` - archive browser page markup and page-specific styles.
- `archive.js` - archive.org list, search, and member loading.
- `host.js` - shared emulator session: machine, display, sound, frame loop, and shared chrome.
- `boot.js` - shader and default ROM fetch.
- `load.js` - TAP, TZX, DCK, or ZIP fetch for `index.html?url=`.
- `io.js` - HTTP GET and local file reads.
- `machine.js` - memory map, Timex paging ports, and frame run.
- `z80.js` - Z80 CPU.
- `keyboard.js` - host keyboard mapping and the F1 overlay.
- `keyboard.png` - TS 2068 keyboard art for the overlay.
- `joystick.js` - host gamepads read as the two TS 2068 joystick ports.
- `tape.js` - TAP/TZX files and cassette EAR pulses.
- `dock.js` - Warajevo `.dck` cartridge parse.
- `zip.js` - ZIP listing and entry extraction used by `load.js` for `?url=` ZIP files. The archive page does not use it.
- `media.js` - tape, cartridge, and junk file-name rules.
- `tsarchive.js` - archive.org Timex Sinclair Software Archive client.
- `ay.js` - AY-3-8912 sound chip.
- `sound.js` - Web Audio host and worklet loader.
- `sound.worklet.js` - mixes ULA and AY channels on the audio thread.
- `screen.js` - WebGL2 display-file renderer.
- `screen.vert.glsl` / `screen.frag.glsl` - display shaders.
- `server.go` - optional local static file server (`go run server.go`).
- `tsconfig.json` - check-only TypeScript config (`noEmit`).
- `roms/` - Machine default ROM files and experimental ROM files.

The experimental Leap ROM files are from [https://github.com/nchiker/2068-Leap-Preview](https://github.com/nchiker/2068-Leap-Preview).
