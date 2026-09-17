#version 300 es
precision mediump float;

uniform highp usampler2D u_tex;
uniform bool u_crt;

in vec2 v_uv;
out vec4 o_color;

// TS 2068 palette, used when the CRT filter is active. Index is the colour
// value, bit 0 blue, bit 1 red, bit 2 green, plus 8 when BRIGHT is set.
// These values are derived from the model below rather than measured from
// hardware.
//
// Hue uses the chroma vector angles of Technical Manual Section 2.1.11.1, but
// only the TS 2068 minus NTSC differences (blue 0, magenta +2, red +4, green
// +2, cyan 0, yellow 0 degrees), which cancels the systematic error in that
// table: its own NTSC column is off by up to 8.5 degrees. The corrections are
// thus smaller than the noise floor of their source and shift no visible
// channel by more than 8 counts. The "Reference 224" row is deliberately not
// applied. The colour rows are vectorscope targets, which are burst-relative by
// definition, so the burst sits at 180 in that frame by construction and
// subtracting 224 would decode cyan as green.
//
// Luma is a model, since the manual gives no level steps and its schematic
// section is "under construction". Normal colours span 0.80 and BRIGHT adds a
// constant 0.20, so bright white reaches the reference white of Figure
// 2.1.11-1. That offset is constant in the signal domain, and composite volts
// and sRGB codes are both gamma encoded, so under common CRT gamma it stays a
// constant code offset. Light goes as V^2.2, which is why one constant turns
// black into a clearly grey background while white barely changes.
//
// The BRIGHT path itself is undocumented: the hardware chapter never mentions
// it and names only R, G and B as DAC inputs. That it lifts black on this
// machine is hardware behaviour, not something the manual establishes.
const uvec3 color_palette[16] = uvec3[16](
    uvec3(0x00u, 0x00u, 0x00u), // black
    uvec3(0x00u, 0x00u, 0xCCu), // blue
    uvec3(0xC9u, 0x05u, 0x00u), // red
    uvec3(0xCEu, 0x00u, 0xC4u), // magenta
    uvec3(0x00u, 0xCCu, 0x08u), // green
    uvec3(0x00u, 0xCCu, 0xCCu), // cyan
    uvec3(0xCCu, 0xCCu, 0x00u), // yellow
    uvec3(0xCCu, 0xCCu, 0xCCu), // white
    uvec3(0x33u, 0x33u, 0x33u), // bright black
    uvec3(0x33u, 0x33u, 0xFFu), // bright blue
    uvec3(0xFCu, 0x38u, 0x33u), // bright red
    uvec3(0xFFu, 0x33u, 0xF7u), // bright magenta
    uvec3(0x33u, 0xFFu, 0x3Bu), // bright green
    uvec3(0x33u, 0xFFu, 0xFFu), // bright cyan
    uvec3(0xFFu, 0xFFu, 0x33u), // bright yellow
    uvec3(0xFFu, 0xFFu, 0xFFu)  // bright white
);

vec3 palette_color(uint color_index) {
    return vec3(color_palette[int(color_index)]) / 255.0;
}

// Idealized palette, used when the CRT filter is off: the same on/off level
// for every channel, no hue shift, with BRIGHT adding a constant offset to
// all three components. Uses the same 0.80/0.20 split as the CRT palette's
// luma model above.
const uint IDEAL_LEVEL = 204u;        // 0xCC, 0.80 * 255
const uint IDEAL_BRIGHT_OFFSET = 51u; // 0x33, 0.20 * 255

vec3 idealized_color(uint color_index) {
    uint blue_bit = color_index & 1u;
    uint red_bit = (color_index >> 1u) & 1u;
    uint green_bit = (color_index >> 2u) & 1u;
    uint bright_bit = (color_index >> 3u) & 1u;
    uvec3 level = uvec3(red_bit, green_bit, blue_bit) * IDEAL_LEVEL
        + uvec3(bright_bit) * IDEAL_BRIGHT_OFFSET;
    return vec3(level) / 255.0;
}

float gaussian_weight(float offset, float inv_sigma_squared) {
    return exp(-0.5 * offset * offset * inv_sigma_squared);
}

void main() {
    if (!u_crt) {
        uint color_index = texture(u_tex, v_uv).r;
        o_color = vec4(idealized_color(color_index), 1.0);
        return;
    }

    ivec2 tex_size = textureSize(u_tex, 0);
    vec2 source = v_uv * vec2(tex_size);
    ivec2 m_texel = clamp(ivec2(floor(source)), ivec2(0), tex_size - 1);
    ivec2 l_texel = ivec2(max(m_texel.x - 1, 0), m_texel.y);
    ivec2 r_texel = ivec2(min(m_texel.x + 1, tex_size.x - 1), m_texel.y);
    vec3 m = palette_color(texelFetch(u_tex, m_texel, 0).r);
    vec3 l = palette_color(texelFetch(u_tex, l_texel, 0).r);
    vec3 r = palette_color(texelFetch(u_tex, r_texel, 0).r);
    float local_x = fract(source.x) - 0.5;
    float beam_phase = 0.5 - 0.5 * cos(6.28318530718 * source.y);
    float sigma = 0.38 + 0.17 * beam_phase;
    float inv_sigma_squared = 1.0 / (sigma * sigma);
    float m_weight = gaussian_weight(local_x, inv_sigma_squared);
    float l_weight = gaussian_weight(local_x + 1.0, inv_sigma_squared);
    float r_weight = gaussian_weight(local_x - 1.0, inv_sigma_squared);
    float weight = m_weight + l_weight + r_weight;
    vec3 color = (m * m_weight + l * l_weight + r * r_weight) / weight;
    float beam = 0.25 + 0.75 * beam_phase;
    o_color = vec4(color * beam, 1.0);
}
