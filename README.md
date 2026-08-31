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
- Load TAP - insert a `.tap`. Playback waits until `LOAD ""` is running so
  the header is not missed. At the `K` cursor press J (`LOAD`), then `""` and
  Enter. Border bars still show while the block loads.
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

**F1** or the Keyboard button shows or hides the original TS 2068 keyboard
under the screen. The emulator display scales to the remaining space. Overlay
keys can be clicked; they light when the matching matrix bits are down.

**F11** makes the page fullscreen with only the emulator canvas (4:3, integer
scaled). Escape or F11 again restores the header.

## Display

The visible picture is the SCLD output: 256x192 paper (512x192 in hi-res) with
a border, integer-scaled to a 4:3 rectangle in the window.

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
- `tape.js` - TAP files and cassette EAR pulses.
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
