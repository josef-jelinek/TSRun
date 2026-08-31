#version 300 es

precision mediump float;
uniform highp usampler2D u_tex;
in vec2 v_uv;
out vec4 o_color;

// Fixed TS 2068 colors addressed by the byte stored for each machine pixel.
const uvec3 color_palette[16] = uvec3[16](
    uvec3(0u, 0u, 0u),       // black
    uvec3(1u, 0u, 206u),     // blue
    uvec3(207u, 1u, 0u),     // red
    uvec3(207u, 1u, 206u),   // magenta
    uvec3(0u, 207u, 21u),    // green
    uvec3(1u, 207u, 207u),   // cyan
    uvec3(207u, 207u, 21u),  // yellow
    uvec3(207u, 207u, 207u), // white
    uvec3(96u, 96u, 96u),    // bright black
    uvec3(2u, 0u, 253u),     // bright blue
    uvec3(255u, 2u, 1u),     // bright red
    uvec3(255u, 2u, 253u),   // bright magenta
    uvec3(0u, 255u, 28u),    // bright green
    uvec3(2u, 255u, 255u),   // bright cyan
    uvec3(255u, 255u, 29u),  // bright yellow
    uvec3(255u, 255u, 255u)  // bright white
);

void main() {
    uint color_index = texture(u_tex, v_uv).r;
    o_color = vec4(vec3(color_palette[int(color_index)]) / 255.0, 1.0);
}
