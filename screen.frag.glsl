#version 300 es
precision mediump float;

uniform highp usampler2D u_tex;
uniform bool u_crt;

in vec2 v_uv;
out vec4 o_color;

// Fixed TS 2068 colors addressed by the byte stored for each machine pixel.
const uvec3 color_palette[16] = uvec3[16](
    uvec3(0x00u, 0x00u, 0x00u), // black
    uvec3(0x01u, 0x00u, 0xCEu), // blue
    uvec3(0xCFu, 0x01u, 0x00u), // red
    uvec3(0xCFu, 0x01u, 0xCEu), // magenta
    uvec3(0x00u, 0xCFu, 0x15u), // green
    uvec3(0x01u, 0xCFu, 0xCFu), // cyan
    uvec3(0xCFu, 0xCFu, 0x15u), // yellow
    uvec3(0xCFu, 0xCFu, 0xCFu), // white
    uvec3(0x60u, 0x60u, 0x60u), // bright black
    uvec3(0x02u, 0x00u, 0xFAu), // bright blue
    uvec3(0xFFu, 0x02u, 0x01u), // bright red
    uvec3(0xFFu, 0x02u, 0xFAu), // bright magenta
    uvec3(0x00u, 0xFFu, 0x1Cu), // bright green
    uvec3(0x02u, 0xFFu, 0xFFu), // bright cyan
    uvec3(0xFFu, 0xFFu, 0x1Du), // bright yellow
    uvec3(0xFFu, 0xFFu, 0xFFu)  // bright white
);

vec3 palette_color(uint color_index) {
    return vec3(color_palette[int(color_index)]) / 255.0;
}

float gaussian_weight(float offset, float inv_sigma_squared) {
    return exp(-0.5 * offset * offset * inv_sigma_squared);
}

void main() {
    if (!u_crt) {
        uint color_index = texture(u_tex, v_uv).r;
        o_color = vec4(palette_color(color_index), 1.0);
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
