#version 300 es

out vec2 v_uv;

void main() {
    // Generate UV quad coordinates from the ID, so no attribute buffer is needed.
    v_uv = vec2(ivec2(gl_VertexID & 1, gl_VertexID >> 1));
    // Vertex coordinates align with scaled symmetrical UV coordinates.
    gl_Position = vec4(v_uv * 2.0 - 1.0, 0.0, 1.0);
}
