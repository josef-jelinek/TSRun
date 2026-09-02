# TSRun

TSRun is a browser emulator for the Timex Sinclair 2068. It loads default
HOME ROM and EXROM from `roms/` when those files are available.
Both ULA beeper and AY-3-8912 are supported. However, the browser may stay
silent until a click or key as it suspends autoplay audio by default.

No build, package manager, or external library is required. ES modules cannot
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

The page is plain JavaScript. `tsconfig.json` is only for optional static
checking during development (`tsc --noEmit` or `npx --yes tsc --noEmit`).

## Command bar

- Reset - restart the Z80 at address 0. A tape is kept, but EAR playback pauses
  until `LOAD ""` is waiting again. A cartridge is kept and the ROM probes it
  again (autostart carts re-run).
- NMI - pulse the Z80 NMI pin (`PC=0x0066`). The stock ROM returns immediately;
  a program that installed an NMI handler will run it.
- Keyboard - show or hide the TS 2068 keyboard under the screen (also F1).
- CRT - fit the display continuously and add rounded pixels, horizontal color
  bleed and scanlines. When off, the display is unfiltered integer-scaled.
- Fullscreen - show only the fullscreen emulator canvas (also F11).
- Load TAP - insert a `.tap` or `.tzx`, or a `.zip` holding one. Playback
  waits until `LOAD ""` is running so the header is not missed. At the `K`
  cursor press J (`LOAD`), then `""` and Enter. Border bars still show while
  the block loads. A `.zip` with one tape image inserts it at once; with more
  than one, the archive panel opens to choose from.
- Archive - on the TAP row, after Load TAP. Opens a panel that browses the
  [Timex Sinclair Software Archive](https://archive.org/details/timex-sinclair-software-archive)
  on archive.org. See [Archive](#archive) below.
- Type LOAD - on the TAP row. When checked (the default), inserting a tape
  also types `LOAD ""` and Enter through the key matrix, so a program loads
  with one click. Uncheck it to type the command yourself, for example when a
  program is running and should not be interrupted.
- Turbo - on the TAP row, after Load TAP. When checked (the default), CPU
  and tape run many times faster than realtime once the loader is sampling EAR.
  Uncheck for ROM-speed playback with the leader tone. T-state custom loaders
  warp as well; this is not an instant ROM poke. Warped frames are not drawn or
  mixed, since only the last frame of each burst reaches the screen and speakers.
- Load DCK - insert a `.dck` dock image and reset so the ROM can autostart
  LROS/AROS. Extra 8K chunks are paged by the program with `OUT 244`.
- Eject - on the DCK row, after Load DCK. Unplugs the cartridge, restores any
  HOME-bank RAM pages the image overwrote, and resets so the ROM no longer
  sees dock memory.
- Load ROM0 - replace the 16K HOME ROM from a `.rom` / `.bin` file and reset.
- Load ROM1 - replace the 8K EXROM the same way.

Reset does not eject a tape or cartridge. After Eject, or with no cartridge, the
ROM should return to the copyright start screen.

## Archive

The Archive button lists the ZIP files of the
[Timex Sinclair Software Archive](https://archive.org/details/timex-sinclair-software-archive)
item on archive.org. Type in the search box to filter titles by words; every
word must appear somewhere in the file name. The TS2068 switch hides titles
tagged for the TS 1000, TS 1500, ZX81 or ZX Spectrum, since those do not run
on the 2068 natively. Escape closes the panel while the search box has focus.

Clicking a title lists the files in its ZIP. The only `.tap` is inserted at
once; failing that the only `.tzx`, and failing that the only `.dck`. With
more than one, click the file to insert. Other files, such as `.txt` notes or
`.wav` recordings, link to archive.org.

Nothing is unpacked in the browser. archive.org serves the listing of a ZIP
at `download/<item>/<zip>/` and any member at `download/<item>/<zip>/<file>`,
and both allow cross-origin reads, while the raw ZIP files do not. Metadata
comes from `https://archive.org/metadata/<item>/files`.

A program that was inserted from the archive is recorded in the page URL as
`?zip=<zip name>&file=<member>`, so the URL can be shared as a link to that
program. `?zip=` alone picks the tape from the ZIP as a click would.

`.tzx` images play through the same EAR line as `.tap`. Standard, turbo,
pure tone, pulse sequence, pure data and direct recording blocks are played
with their own timings; loops, jumps and call sequences are unrolled; a
"stop the tape" pause parks the tape until `LOAD ""` runs again. CSW and
generalized data blocks are not supported. Cassette `.wav` recordings in the
archive are not played.

## Sound

The ULA speaker (port `FE` bit 4) and the AY-3-8912 (ports `F5`/`F6`) are
mixed in the browser. A click or key may be required before anything is
audible. The machine runs at 60 Hz wall-clock; about one video frame of
samples is queued so `BEEP` and tape edges stay in time.

Both sources are integrated on the CPU clock. The AY runs on its own tick grid
(one tick per 16 T-states) rather than on the output sample rate, and every
beeper edge, AY register write and tape edge is applied at the exact T-state it
happens. Each output sample is the time-weighted average over its window, so an
envelope retrigger lands where the program put it instead of being rounded to
the nearest sample. `BEEP` uses the
ULA; `SOUND register,value` talks to the AY. Tape EAR is mixed quietly so
loading can be heard. The real 2068 is mono; AY channels are panned ABC for
convenience.

## Keyboard

The host keyboard is mapped onto the TS 2068 8x5 matrix (port `FE`). Letters
and digits match the keycaps. Both Shift keys are Caps Shift; both Ctrl keys
are Symbol Shift. Extra mappings:

- Backspace / Delete - Caps Shift + 0
- Arrow keys - Caps Shift + 5/6/7/8
- Escape - BREAK (Caps Shift + Space); or exit full-screen mode
- Tab - EDIT (Caps Shift + 1)
- `.` `,` `;` `"` `-` `=` `/` - the usual Symbol Shift pairs

**F1** or the Keyboard switch shows or hides the original TS 2068 keyboard
under the screen. The emulator display scales to the remaining space. Overlay
keys can be clicked; they light when the matching matrix bits are down.

**F11** or the Fullscreen button makes the page fullscreen with only the
emulator canvas (4:3, integer scaled). Escape or F11 again restores the header.

## Display

The visible picture is the SCLD output: 256x192 paper (512x192 in hi-res) with
a border, integer-scaled to a 4:3 rectangle in the window.

The optional CRT mode fills the available 4:3 area and renders at the physical
display resolution. It adds restrained horizontal color bleed and scanlines,
without distortion, chromatic aberration, bloom, noise or a vignette.

The picture is drawn by following the beam rather than by grabbing the display
file once per frame. The raster is free-running at 224 T-states per line and
262.5 lines per frame (exactly the 58800 T-states of one 60 Hz frame), and one
T-state is two pixels. Anything the raster reads - the border, the port `FF`
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
  from screen 1. Ink/paper (and the border) come from bits 5-3, always bright;
  `OUT 255,6` is black on white.

Stock BASIC still prints to screen 0. Hi-color and hi-res reuse `0x6000`-`0x7AFF`,
where the ROM keeps a RAM copy of the OS, so those modes need machine code that
moves the stack and system variables first.

The start screen is white paper, white border, and two copyright lines at the
bottom. During tape load the ROM changes the border on each EAR edge, which the
beam renders as bars that break mid-line, as on hardware. Bit 6 of port `FF` inhibits the 60 Hz interrupt.

## Repository files

- `README.md` - project overview and user documentation.
- `index.html` - page markup and styles.
- `main.js` - UI wiring, ROM load, and the animation-frame loop.
- `io.js` - HTTP GET and local file reads.
- `machine.js` - memory map, Timex paging ports, and frame run.
- `z80.js` - Z80 CPU.
- `keyboard.js` - host keyboard mapping and the F1 overlay.
- `tape.js` - tape blocks with their timings, TAP parse, and cassette EAR pulses.
- `tzx.js` - TZX parse into tape blocks.
- `zip.js` - ZIP listing and member inflate, for local `.zip` files.
- `archive.js` - archive.org index, ZIP listing and member fetch.
- `dock.js` - Warajevo `.dck` cartridge parse.
- `ay.js` - AY-3-8912 sound chip.
- `sound.js` - Web Audio host and worklet loader.
- `sound.worklet.js` - mixes ULA and AY channels on the audio thread.
- `screen.js` - WebGL2 display-file renderer.
- `screen.vert.glsl` / `screen.frag.glsl` - display shaders.
- `server.go` - optional local static file server (`go run server.go`).
- `tsconfig.json` - check-only TypeScript config (`noEmit`).
- `roms/` - Machine default ROM files and experimental ROM files.

The experimental Leap ROM files are from [https://github.com/nchiker/2068-Leap-Preview](https://github.com/nchiker/2068-Leap-Preview).
