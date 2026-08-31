#version 300 es

out vec2 v_uv;

void main() {
    vec2 p = vec2(ivec2(gl_VertexID & 1, gl_VertexID >> 1) * 2 - 1);
    v_uv = p * 0.5 + 0.5;
    gl_Position = vec4(p, 0.0, 1.0);
}
