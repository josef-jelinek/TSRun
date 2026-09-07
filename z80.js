const flagC = 0x01;
const flagN = 0x02;
const flagP = 0x04;
const flagX = 0x08;
const flagH = 0x10;
const flagY = 0x20;
const flagZ = 0x40;
const flagS = 0x80;

const z80ResetState = {
    a: 0,
    f: 0,
    b: 0,
    c: 0,
    d: 0,
    e: 0,
    h: 0,
    l: 0,
    a2: 0,
    f2: 0,
    b2: 0,
    c2: 0,
    d2: 0,
    e2: 0,
    h2: 0,
    l2: 0,
    xh: 0,
    xl: 0,
    yh: 0,
    yl: 0,
    sp: 0,
    pc: 0,
    i: 0,
    r: 0,
    iff1: false,
    iff2: false,
    im: 0,
    halted: false,
    eiDelay: false,
    nmiPending: false,
};

// S/Z and undocumented result bits 5/3, cached for hot instruction paths.
const sz53 = new Uint8Array(256);
// The same result flags with even parity included.
const sz53p = new Uint8Array(256);

for (let i = 0; i < 256; i += 1) {
    let f = i & (flagX | flagY | flagS);
    if (i === 0) {
        f |= flagZ;
    }
    sz53[i] = f;
    let p = i;
    p ^= p >>> 4;
    p ^= p >>> 2;
    p ^= p >>> 1;
    if ((p & 1) === 0) {
        f |= flagP;
    }
    sz53p[i] = f;
}

/**
 * @typedef {{
 *   a: number,
 *   f: number,
 *   b: number,
 *   c: number,
 *   d: number,
 *   e: number,
 *   h: number,
 *   l: number,
 *   a2: number,
 *   f2: number,
 *   b2: number,
 *   c2: number,
 *   d2: number,
 *   e2: number,
 *   h2: number,
 *   l2: number,
 *   xh: number,
 *   xl: number,
 *   yh: number,
 *   yl: number,
 *   sp: number,
 *   pc: number,
 *   i: number,
 *   r: number,
 *   iff1: boolean,
 *   iff2: boolean,
 *   im: number,
 *   halted: boolean,
 *   eiDelay: boolean,
 *   nmiPending: boolean,
 * }} Z80
 */

/**
 * @typedef {{
 *   read: function(number): number,
 *   write: function(number, number): void,
 *   ioRead: function(number): number,
 *   ioWrite: function(number, number): void,
 * }} Z80Bus
 */

/**
 * stepAdded holds the cycles a step already charged to tstates ahead of time,
 * so runZ80 can charge only the remainder once the step returns.
 *
 * @typedef {{
 *   tstates: number,
 *   stepAdded: number,
 * }} Z80Clock
 */

// CPU state lifecycle and externally requested interrupt entry points.

/** @returns {Z80} */
export function createZ80() {
    return {...z80ResetState};
}

/** @param {Z80} cpu */
export function resetZ80(cpu) {
    Object.assign(cpu, z80ResetState);
}

/**
 * clock.tstates advances after each instruction so IN FE sees a live EAR level.
 *
 * @param {Z80} cpu
 * @param {Z80Bus} bus
 * @param {number} limit
 * @param {Z80Clock} clock
 */
export function runZ80(cpu, bus, limit, clock) {
    let used = 0;
    while (used < limit) {
        if (cpu.nmiPending) {
            const n = nmiZ80(cpu, bus);
            used += n;
            clock.tstates += n;
            continue;
        }
        if (cpu.halted) {
            const remain = limit - used;
            const steps = Math.floor(remain / 4);
            if (steps < 1) {
                break;
            }
            const add = steps * 4;
            used += add;
            clock.tstates += add;
            cpu.r = (cpu.r & 0x80) | ((cpu.r + steps) & 0x7F);
            break;
        }
        const n = stepZ80(cpu, bus, clock);
        used += n;
        clock.tstates += n - clock.stepAdded;
    }
}

/**
 * @param {Z80} cpu
 * @param {Z80Bus} bus
 * @returns {number}
 */
export function irqZ80(cpu, bus) {
    if (!cpu.iff1 || cpu.eiDelay) {
        return 0;
    }
    cpu.halted = false;
    cpu.iff1 = false;
    cpu.iff2 = false;
    bumpR(cpu);
    push16(cpu, bus, cpu.pc);
    if (cpu.im === 2) {
        const vec = (cpu.i << 8) | 0xFF;
        cpu.pc = read16(bus, vec);
        return 19;
    }
    cpu.pc = 0x0038;
    return 13;
}

/**
 * Accept NMI: store IFF1 in IFF2, clear IFF1, push PC, jump to 0x0066.
 *
 * @param {Z80} cpu
 * @param {Z80Bus} bus
 * @returns {number}
 */
export function nmiZ80(cpu, bus) {
    cpu.nmiPending = false;
    cpu.halted = false;
    cpu.eiDelay = false;
    cpu.iff2 = cpu.iff1;
    cpu.iff1 = false;
    bumpR(cpu);
    push16(cpu, bus, cpu.pc);
    cpu.pc = 0x0066;
    return 11;
}

// Instruction fetch and the regular, CB, and ED opcode maps.

/**
 * Fetch one instruction, consume repeated IX/IY prefixes, then select its opcode map.
 *
 * @param {Z80} cpu
 * @param {Z80Bus} bus
 * @param {Z80Clock} clock
 * @returns {number}
 */
function stepZ80(cpu, bus, clock) {
    clock.stepAdded = 0;
    cpu.eiDelay = false;
    bumpR(cpu);
    let op = bus.read(cpu.pc);
    cpu.pc = (cpu.pc + 1) & 0xFFFF;
    let prefix = 0;
    let cycles = 0;
    while (op === 0xDD || op === 0xFD) {
        prefix = op;
        cycles += 4;
        chargeIo(clock, 4); // each prefix is a real M1 cycle before the opcode
        bumpR(cpu);
        op = bus.read(cpu.pc);
        cpu.pc = (cpu.pc + 1) & 0xFFFF;
    }
    if (op === 0xCB) {
        return cycles + stepCB(cpu, bus, prefix);
    }
    if (op === 0xED) {
        return cycles + stepED(cpu, bus, clock);
    }
    return cycles + stepMain(cpu, bus, op, prefix, clock);
}

/**
 * Decode the regular opcode map, with DD/FD substituting IX/IY for HL.
 * The Z80 table uses x=bits 7-6, y=bits 5-3, z=bits 2-0, p=y>>1, q=y&1.
 *
 * @param {Z80} cpu
 * @param {Z80Bus} bus
 * @param {number} op
 * @param {number} prefix
 * @param {Z80Clock} clock
 * @returns {number}
 */
function stepMain(cpu, bus, op, prefix, clock) {
    const x = op >>> 6;
    const y = (op >>> 3) & 7;
    const z = op & 7;
    const p = y >>> 1;
    const q = y & 1;

    switch (x) {
    case 0: { // x=0: control, 16-bit loads, 8-bit INC/DEC/LD, and accumulator operations
        let carry = 0;
        switch (z) {
        case 0: { // NOP, EX AF,AF', DJNZ, JR, and JR cc
            let d = 0;
            switch (y) {
            case 0: // NOP
                return 4;
            case 1: { // EX AF,AF'
                const a = cpu.a;
                const f = cpu.f;
                cpu.a = cpu.a2;
                cpu.f = cpu.f2;
                cpu.a2 = a;
                cpu.f2 = f;
                return 4;
            }
            case 2: // DJNZ d
                d = fetch8s(cpu, bus);
                cpu.b = (cpu.b - 1) & 0xFF;
                if (cpu.b !== 0) {
                    cpu.pc = (cpu.pc + d) & 0xFFFF;
                    return 13;
                }
                return 8;
            case 3: // JR d
                d = fetch8s(cpu, bus);
                cpu.pc = (cpu.pc + d) & 0xFFFF;
                return 12;
            default: // JR cc,d (NZ, Z, NC, or C)
                d = fetch8s(cpu, bus);
                if (cond(cpu, y - 4)) {
                    cpu.pc = (cpu.pc + d) & 0xFFFF;
                    return 12;
                }
                return 7;
            }
        }
        case 1: // LD rp,nn and ADD HL/IX/IY,rp
            if (q === 0) {
                setRP(cpu, p, prefix, fetch16(cpu, bus));
                return 10;
            }
            addXY(cpu, prefix, getRP(cpu, p, prefix));
            return 11;
        case 2: // Indirect loads through BC, DE, nn, and HL/IX/IY.
            if (q === 0) {
                switch (p) {
                case 0: // LD (BC),A
                    bus.write((cpu.b << 8) | cpu.c, cpu.a);
                    return 7;
                case 1: // LD (DE),A
                    bus.write((cpu.d << 8) | cpu.e, cpu.a);
                    return 7;
                case 2: // LD (nn),HL/IX/IY
                    write16(bus, fetch16(cpu, bus), getXY(cpu, prefix));
                    return 16;
                default: // LD (nn),A
                    bus.write(fetch16(cpu, bus), cpu.a);
                    return 13;
                }
            }
            switch (p) {
            case 0: // LD A,(BC)
                cpu.a = bus.read((cpu.b << 8) | cpu.c);
                return 7;
            case 1: // LD A,(DE)
                cpu.a = bus.read((cpu.d << 8) | cpu.e);
                return 7;
            case 2: // LD HL/IX/IY,(nn)
                setXY(cpu, prefix, read16(bus, fetch16(cpu, bus)));
                return 16;
            default: // LD A,(nn)
                cpu.a = bus.read(fetch16(cpu, bus));
                return 13;
            }
        case 3: // INC/DEC rp
            if (q === 0) {
                setRP(cpu, p, prefix, (getRP(cpu, p, prefix) + 1) & 0xFFFF);
            } else {
                setRP(cpu, p, prefix, (getRP(cpu, p, prefix) - 1) & 0xFFFF);
            }
            return 6;
        case 4: // INC r or INC (HL/IX/IY+d)
            if (y === 6) {
                let addr;
                let cycles;
                if (prefix !== 0) {
                    addr = (getXY(cpu, prefix) + fetch8s(cpu, bus)) & 0xFFFF;
                    cycles = 19;
                } else {
                    addr = (cpu.h << 8) | cpu.l;
                    cycles = 11;
                }
                const value = inc8(cpu, bus.read(addr));
                bus.write(addr, value);
                return cycles;
            }
            setR8(cpu, y, prefix, inc8(cpu, getR8(cpu, y, prefix)));
            return 4;
        case 5: // DEC r or DEC (HL/IX/IY+d)
            if (y === 6) {
                let addr;
                let cycles;
                if (prefix !== 0) {
                    addr = (getXY(cpu, prefix) + fetch8s(cpu, bus)) & 0xFFFF;
                    cycles = 19;
                } else {
                    addr = (cpu.h << 8) | cpu.l;
                    cycles = 11;
                }
                const value = dec8(cpu, bus.read(addr));
                bus.write(addr, value);
                return cycles;
            }
            setR8(cpu, y, prefix, dec8(cpu, getR8(cpu, y, prefix)));
            return 4;
        case 6: // LD r,n or LD (HL/IX/IY+d),n
            if (y === 6) {
                if (prefix !== 0) {
                    const d = fetch8s(cpu, bus);
                    const value = fetch8(cpu, bus);
                    bus.write((getXY(cpu, prefix) + d) & 0xFFFF, value);
                    return 15;
                }
                bus.write((cpu.h << 8) | cpu.l, fetch8(cpu, bus));
                return 10;
            }
            setR8(cpu, y, prefix, fetch8(cpu, bus));
            return 7;
        default: // RLCA, RRCA, RLA, RRA, DAA, CPL, SCF, and CCF
            switch (y) {
            case 0: // RLCA
                carry = cpu.a >>> 7;
                cpu.a = ((cpu.a << 1) | carry) & 0xFF;
                cpu.f = (cpu.f & (flagS | flagZ | flagP | flagX | flagY)) | carry;
                return 4;
            case 1: // RRCA
                carry = cpu.a & 1;
                cpu.a = ((cpu.a >>> 1) | (carry << 7)) & 0xFF;
                cpu.f = (cpu.f & (flagS | flagZ | flagP | flagX | flagY)) | carry;
                return 4;
            case 2: // RLA
                carry = cpu.a >>> 7;
                cpu.a = ((cpu.a << 1) | (cpu.f & flagC)) & 0xFF;
                cpu.f = (cpu.f & (flagS | flagZ | flagP | flagX | flagY)) | carry;
                return 4;
            case 3: // RRA
                carry = cpu.a & 1;
                cpu.a = ((cpu.a >>> 1) | ((cpu.f & flagC) << 7)) & 0xFF;
                cpu.f = (cpu.f & (flagS | flagZ | flagP | flagX | flagY)) | carry;
                return 4;
            case 4: // DAA
                daa(cpu);
                return 4;
            case 5: // CPL
                cpu.a = (cpu.a ^ 0xFF) & 0xFF;
                cpu.f = (cpu.f & (flagC | flagS | flagZ | flagP))
                    | flagH | flagN | (cpu.a & (flagX | flagY));
                return 4;
            case 6: // SCF
                cpu.f = (cpu.f & (flagS | flagZ | flagP | flagX | flagY)) | flagC;
                return 4;
            default: // CCF
                carry = cpu.f & flagC;
                cpu.f = (cpu.f & (flagS | flagZ | flagP)) | (cpu.a & (flagX | flagY));
                if (carry !== 0) {
                    cpu.f |= flagH;
                } else {
                    cpu.f |= flagC;
                }
                return 4;
            }
        }
    }
    case 1: { // x=1: HALT and the complete LD r,r' matrix
        if (y === 6 && z === 6) {
            cpu.halted = true;
            return 4;
        }
        let srcPrefix = prefix;
        let dstPrefix = prefix;
        if (y === 6) {
            srcPrefix = 0;
        }
        if (z === 6) {
            dstPrefix = 0;
        }
        let addr = 0;
        let cycles = 4;
        if (z === 6 || y === 6) {
            if (prefix !== 0) {
                addr = (getXY(cpu, prefix) + fetch8s(cpu, bus)) & 0xFFFF;
                cycles = 15;
            } else {
                addr = (cpu.h << 8) | cpu.l;
                cycles = 7;
            }
        }
        let value;
        if (z === 6) {
            value = bus.read(addr);
        } else {
            value = getR8(cpu, z, srcPrefix);
        }
        if (y === 6) {
            bus.write(addr, value);
        } else {
            setR8(cpu, y, dstPrefix, value);
        }
        return cycles;
    }
    case 2: { // x=2: ADD/ADC/SUB/SBC/AND/XOR/OR/CP A,r
        let value;
        let cycles = 4;
        if (z === 6) {
            let addr;
            if (prefix !== 0) {
                addr = (getXY(cpu, prefix) + fetch8s(cpu, bus)) & 0xFFFF;
                cycles = 15;
            } else {
                addr = (cpu.h << 8) | cpu.l;
                cycles = 7;
            }
            value = bus.read(addr);
        } else {
            value = getR8(cpu, z, prefix);
        }
        aluA(cpu, y, value);
        return cycles;
    }
    default: // x=3: returns, jumps, calls, stack operations, immediate ALU, and RST
        switch (z) {
        case 0: // RET cc
            if (cond(cpu, y)) {
                cpu.pc = pop16(cpu, bus);
                return 11;
            }
            return 5;
        case 1: { // POP rp2, RET, EXX, JP HL/IX/IY, and LD SP,HL/IX/IY
            if (q === 0) {
                const value = pop16(cpu, bus);
                if (p === 3) {
                    cpu.a = (value >>> 8) & 0xFF;
                    cpu.f = value & 0xFF;
                } else {
                    setRP(cpu, p, prefix, value);
                }
                return 10;
            }
            switch (p) {
            case 0: // RET
                cpu.pc = pop16(cpu, bus);
                return 10;
            case 1: { // EXX
                const b = cpu.b;
                const c = cpu.c;
                const d = cpu.d;
                const e = cpu.e;
                const h = cpu.h;
                const l = cpu.l;
                cpu.b = cpu.b2;
                cpu.c = cpu.c2;
                cpu.d = cpu.d2;
                cpu.e = cpu.e2;
                cpu.h = cpu.h2;
                cpu.l = cpu.l2;
                cpu.b2 = b;
                cpu.c2 = c;
                cpu.d2 = d;
                cpu.e2 = e;
                cpu.h2 = h;
                cpu.l2 = l;
                return 4;
            }
            case 2: // JP (HL/IX/IY)
                cpu.pc = getXY(cpu, prefix);
                return 4;
            default: // LD SP,HL/IX/IY
                cpu.sp = getXY(cpu, prefix);
                return 6;
            }
        }
        case 2: { // JP cc,nn
            const nn = fetch16(cpu, bus);
            if (cond(cpu, y)) {
                cpu.pc = nn;
            }
            return 10;
        }
        case 3: // JP nn, I/O, exchanges, and interrupt control. Prefix opcodes were handled above
            switch (y) {
            case 0: // JP nn
                cpu.pc = fetch16(cpu, bus);
                return 10;
            case 2: { // OUT (n),A: M1 4, operand 3, then the I/O cycle
                const port = fetch8(cpu, bus) | (cpu.a << 8);
                chargeIo(clock, 7);
                bus.ioWrite(port, cpu.a);
                return 11;
            }
            case 3: { // IN A,(n): M1 4, operand 3, then the I/O cycle
                const port = fetch8(cpu, bus) | (cpu.a << 8);
                chargeIo(clock, 7);
                cpu.a = bus.ioRead(port) & 0xFF;
                return 11;
            }
            case 4: { // EX (SP),HL/IX/IY
                const xy = getXY(cpu, prefix);
                const value = read16(bus, cpu.sp);
                write16(bus, cpu.sp, xy);
                setXY(cpu, prefix, value);
                return 19;
            }
            case 5: { // EX DE,HL
                const d = cpu.d;
                const e = cpu.e;
                cpu.d = cpu.h;
                cpu.e = cpu.l;
                cpu.h = d;
                cpu.l = e;
                return 4;
            }
            case 6: // DI
                cpu.iff1 = false;
                cpu.iff2 = false;
                cpu.eiDelay = false;
                return 4;
            default: // EI
                cpu.iff1 = true;
                cpu.iff2 = true;
                cpu.eiDelay = true;
                return 4;
            }
        case 4: { // CALL cc,nn
            const nn = fetch16(cpu, bus);
            if (cond(cpu, y)) {
                push16(cpu, bus, cpu.pc);
                cpu.pc = nn;
                return 17;
            }
            return 10;
        }
        case 5: { // PUSH rp2 and CALL nn. DD/ED/FD prefixes were handled above
            if (q === 0) {
                let value;
                if (p === 3) {
                    value = (cpu.a << 8) | cpu.f;
                } else {
                    value = getRP(cpu, p, prefix);
                }
                push16(cpu, bus, value);
                return 11;
            }
            const nn = fetch16(cpu, bus);
            push16(cpu, bus, cpu.pc);
            cpu.pc = nn;
            return 17;
        }
        case 6: // Immediate ALU operations
            aluA(cpu, y, fetch8(cpu, bus));
            return 7;
        default: // RST y*8
            push16(cpu, bus, cpu.pc);
            cpu.pc = y * 8;
            return 11;
        }
    }
}

/**
 * Decode CB and DD/FD-CB bit operations.
 * x=0 rotates/shifts, x=1 tests, x=2 resets, and x=3 sets bit y in operand z.
 * Indexed forms always use (IX/IY+d), then copy non-BIT results to z when z!=6.
 *
 * @param {Z80} cpu
 * @param {Z80Bus} bus
 * @param {number} prefix
 * @returns {number}
 */
function stepCB(cpu, bus, prefix) {
    const indexed = prefix !== 0;
    let op;
    let addr;
    if (indexed) {
        const d = fetch8s(cpu, bus);
        op = fetch8(cpu, bus);
        addr = (getXY(cpu, prefix) + d) & 0xFFFF;
    } else {
        bumpR(cpu);
        op = fetch8(cpu, bus);
        addr = (cpu.h << 8) | cpu.l;
    }

    const x = op >>> 6;
    const y = (op >>> 3) & 7;
    const z = op & 7;
    let value;
    if (indexed || z === 6) {
        value = bus.read(addr);
    } else {
        value = getR8(cpu, z, 0);
    }

    if (x === 1) {
        bitCB(cpu, y, value);
        if (indexed) {
            cpu.f = (cpu.f & ~(flagX | flagY)) | ((addr >>> 8) & (flagX | flagY));
            return 16;
        }
        if (z === 6) {
            return 12;
        }
        return 8;
    }

    if (x === 0) {
        value = rotateCB(cpu, y, value);
    } else if (x === 2) {
        value = value & ~(1 << y);
    } else {
        value = value | (1 << y);
    }
    value &= 0xFF;

    if (indexed || z === 6) {
        bus.write(addr, value);
    }
    if (z !== 6) {
        setR8(cpu, z, 0, value);
    }
    if (indexed) {
        return 19;
    }
    if (z === 6) {
        return 15;
    }
    return 8;
}

/**
 * Decode ED extended operations.
 * x=1 contains I/O, 16-bit arithmetic/load, NEG, RETN/RETI, IM, and special registers.
 * x=2 with y>=4 contains the LDI/CPI/INI/OUTI block families; other encodings are NOPs.
 *
 * @param {Z80} cpu
 * @param {Z80Bus} bus
 * @param {Z80Clock} clock
 * @returns {number}
 */
function stepED(cpu, bus, clock) {
    bumpR(cpu);
    const op = fetch8(cpu, bus);
    const x = op >>> 6;
    const y = (op >>> 3) & 7;
    const z = op & 7;
    const p = y >>> 1;
    const q = y & 1;

    if (x === 1) {
        switch (z) {
        case 0: { // IN r,(C), including the flag-only undocumented form
            chargeIo(clock, 8); // M1 4 + ED opcode 4, then the I/O cycle
            const value = bus.ioRead((cpu.b << 8) | cpu.c) & 0xFF;
            if (y !== 6) {
                setR8(cpu, y, 0, value);
            }
            cpu.f = sz53p[value] | (cpu.f & flagC);
            return 12;
        }
        case 1: { // OUT (C),r, with zero for the undocumented y=6 form
            let value = 0;
            if (y !== 6) {
                value = getR8(cpu, y, 0);
            }
            chargeIo(clock, 8); // M1 4 + ED opcode 4, then the I/O cycle
            bus.ioWrite((cpu.b << 8) | cpu.c, value);
            return 12;
        }
        case 2: // SBC/ADC HL,rp
            if (q === 0) {
                sbcHL(cpu, getRP(cpu, p, 0));
            } else {
                adcHL(cpu, getRP(cpu, p, 0));
            }
            return 15;
        case 3: { // LD (nn),rp and LD rp,(nn)
            const nn = fetch16(cpu, bus);
            if (q === 0) {
                write16(bus, nn, getRP(cpu, p, 0));
            } else {
                setRP(cpu, p, 0, read16(bus, nn));
            }
            return 20;
        }
        case 4: { // NEG and its duplicate encodings
            const value = cpu.a;
            cpu.a = 0;
            subA(cpu, value, 0);
            return 8;
        }
        case 5: // RETN/RETI duplicate encodings share the same visible state here
            cpu.iff1 = cpu.iff2;
            cpu.pc = pop16(cpu, bus);
            return 14;
        case 6: // IM 0/1/2 and duplicate encodings
            if ((y & 3) === 2) {
                cpu.im = 1;
            } else if ((y & 3) === 3) {
                cpu.im = 2;
            } else {
                cpu.im = 0;
            }
            return 8;
        default: // LD I/R,A, LD A,I/R, RRD, and RLD
            switch (y) {
            case 0: // LD I,A
                cpu.i = cpu.a;
                return 9;
            case 1: // LD R,A
                cpu.r = cpu.a;
                return 9;
            case 2: // LD A,I
                cpu.a = cpu.i;
                cpu.f = sz53[cpu.a] | (cpu.f & flagC);
                if (cpu.iff2) {
                    cpu.f |= flagP;
                }
                return 9;
            case 3: // LD A,R
                cpu.a = cpu.r;
                cpu.f = sz53[cpu.a] | (cpu.f & flagC);
                if (cpu.iff2) {
                    cpu.f |= flagP;
                }
                return 9;
            case 4: { // RRD
                const addr = (cpu.h << 8) | cpu.l;
                const memory = bus.read(addr);
                const a = cpu.a;
                bus.write(addr, ((a << 4) | (memory >>> 4)) & 0xFF);
                cpu.a = (a & 0xF0) | (memory & 0x0F);
                cpu.f = sz53p[cpu.a] | (cpu.f & flagC);
                return 18;
            }
            case 5: { // RLD
                const addr = (cpu.h << 8) | cpu.l;
                const memory = bus.read(addr);
                const a = cpu.a;
                bus.write(addr, ((memory << 4) | (a & 0x0F)) & 0xFF);
                cpu.a = (a & 0xF0) | ((memory >>> 4) & 0x0F);
                cpu.f = sz53p[cpu.a] | (cpu.f & flagC);
                return 18;
            }
            default: // undocumented NOP encodings
                return 8;
            }
        }
    }

    if (x === 2 && z <= 3 && y >= 4) {
        switch (z) {
        case 0: // LDI, LDD, LDIR, or LDDR
            return blockLoad(cpu, bus, y);
        case 1: // CPI, CPD, CPIR, or CPDR
            return blockCp(cpu, bus, y);
        case 2: // INI, IND, INIR, or INDR
            return blockIo(cpu, bus, y, true, clock);
        default: // OUTI, OUTD, OTIR, or OTDR
            return blockIo(cpu, bus, y, false, clock);
        }
    }
    return 8;
}

// Arithmetic and flag helpers shared by the regular, CB, and ED maps.

/**
 * @param {Z80} cpu
 * @param {number} y
 * @param {number} val
 */
function aluA(cpu, y, val) {
    switch (y) {
    case 0: // ADD A,value
        addA(cpu, val, 0);
        break;
    case 1: // ADC A,value
        addA(cpu, val, cpu.f & flagC);
        break;
    case 2: // SUB value
        subA(cpu, val, 0);
        break;
    case 3: // SBC A,value
        subA(cpu, val, cpu.f & flagC);
        break;
    case 4: // AND A
        cpu.a = (cpu.a & val) & 0xFF;
        cpu.f = sz53p[cpu.a] | flagH;
        break;
    case 5: // XOR A
        cpu.a = (cpu.a ^ val) & 0xFF;
        cpu.f = sz53p[cpu.a];
        break;
    case 6: // OR A
        cpu.a = (cpu.a | val) & 0xFF;
        cpu.f = sz53p[cpu.a];
        break;
    default: // CP value
        cpA(cpu, val);
        break;
    }
}

/**
 * @param {Z80} cpu
 * @param {number} val
 * @param {number} carry
 */
function addA(cpu, val, carry) {
    const a = cpu.a;
    const res = a + val + carry;
    const aa = res & 0xFF;
    cpu.f = sz53[aa];
    if (res > 0xFF) {
        cpu.f |= flagC;
    }
    if (((a & 0x0F) + (val & 0x0F) + carry) > 0x0F) {
        cpu.f |= flagH;
    }
    if (((a ^ aa) & (val ^ aa) & 0x80) !== 0) {
        cpu.f |= flagP;
    }
    cpu.a = aa;
}

/**
 * @param {Z80} cpu
 * @param {number} val
 * @param {number} carry
 */
function subA(cpu, val, carry) {
    const a = cpu.a;
    const res = a - val - carry;
    const aa = res & 0xFF;
    cpu.f = sz53[aa] | flagN;
    if (res < 0) {
        cpu.f |= flagC;
    }
    if (((a & 0x0F) - (val & 0x0F) - carry) < 0) {
        cpu.f |= flagH;
    }
    if (((a ^ val) & (a ^ aa) & 0x80) !== 0) {
        cpu.f |= flagP;
    }
    cpu.a = aa;
}

/**
 * @param {Z80} cpu
 * @param {number} val
 */
function cpA(cpu, val) {
    const a = cpu.a;
    const res = a - val;
    const aa = res & 0xFF;
    cpu.f = (sz53[aa] & ~(flagX | flagY)) | flagN | (val & (flagX | flagY));
    if (res < 0) {
        cpu.f |= flagC;
    }
    if (((a & 0x0F) - (val & 0x0F)) < 0) {
        cpu.f |= flagH;
    }
    if (((a ^ val) & (a ^ aa) & 0x80) !== 0) {
        cpu.f |= flagP;
    }
}

/**
 * @param {Z80} cpu
 * @param {number} val
 * @returns {number}
 */
function inc8(cpu, val) {
    const res = (val + 1) & 0xFF;
    cpu.f = sz53[res] | (cpu.f & flagC);
    if ((val & 0x0F) === 0x0F) {
        cpu.f |= flagH;
    }
    if (val === 0x7F) {
        cpu.f |= flagP;
    }
    return res;
}

/**
 * @param {Z80} cpu
 * @param {number} val
 * @returns {number}
 */
function dec8(cpu, val) {
    const res = (val - 1) & 0xFF;
    cpu.f = sz53[res] | flagN | (cpu.f & flagC);
    if ((val & 0x0F) === 0) {
        cpu.f |= flagH;
    }
    if (val === 0x80) {
        cpu.f |= flagP;
    }
    return res;
}

/**
 * @param {Z80} cpu
 * @param {number} prefix
 * @param {number} val
 */
function addXY(cpu, prefix, val) {
    const xy = getXY(cpu, prefix);
    const res = xy + val;
    cpu.f = cpu.f & (flagS | flagZ | flagP);
    if (res > 0xFFFF) {
        cpu.f |= flagC;
    }
    if (((xy & 0x0FFF) + (val & 0x0FFF)) > 0x0FFF) {
        cpu.f |= flagH;
    }
    const hi = (res >>> 8) & 0xFF;
    cpu.f |= hi & (flagX | flagY);
    setXY(cpu, prefix, res & 0xFFFF);
}

/**
 * @param {Z80} cpu
 * @param {number} val
 */
function adcHL(cpu, val) {
    const hl = (cpu.h << 8) | cpu.l;
    const carry = cpu.f & flagC;
    const res = hl + val + carry;
    const aa = res & 0xFFFF;
    cpu.h = (aa >>> 8) & 0xFF;
    cpu.l = aa & 0xFF;
    cpu.f = (cpu.h & (flagS | flagX | flagY));
    if (aa === 0) {
        cpu.f |= flagZ;
    }
    if (res > 0xFFFF) {
        cpu.f |= flagC;
    }
    if (((hl & 0x0FFF) + (val & 0x0FFF) + carry) > 0x0FFF) {
        cpu.f |= flagH;
    }
    if (((hl ^ aa) & (val ^ aa) & 0x8000) !== 0) {
        cpu.f |= flagP;
    }
}

/**
 * @param {Z80} cpu
 * @param {number} val
 */
function sbcHL(cpu, val) {
    const hl = (cpu.h << 8) | cpu.l;
    const carry = cpu.f & flagC;
    const res = hl - val - carry;
    const aa = res & 0xFFFF;
    cpu.h = (aa >>> 8) & 0xFF;
    cpu.l = aa & 0xFF;
    cpu.f = flagN | (cpu.h & (flagS | flagX | flagY));
    if (aa === 0) {
        cpu.f |= flagZ;
    }
    if (res < 0) {
        cpu.f |= flagC;
    }
    if (((hl & 0x0FFF) - (val & 0x0FFF) - carry) < 0) {
        cpu.f |= flagH;
    }
    if (((hl ^ val) & (hl ^ aa) & 0x8000) !== 0) {
        cpu.f |= flagP;
    }
}

/** @param {Z80} cpu */
function daa(cpu) {
    const a = cpu.a;
    const n = (cpu.f & flagN) !== 0;
    const h = (cpu.f & flagH) !== 0;
    const c = (cpu.f & flagC) !== 0;
    let corr = 0;
    let newC = false;
    if (h || (a & 0x0F) > 9) {
        corr |= 0x06;
    }
    if (c || a > 0x99) {
        corr |= 0x60;
        newC = true;
    }
    let res;
    if (n) {
        res = (a - corr) & 0xFF;
    } else {
        res = (a + corr) & 0xFF;
    }
    cpu.a = res;
    cpu.f = sz53p[res];
    if (n) {
        cpu.f |= flagN;
    }
    if (newC) {
        cpu.f |= flagC;
    }
    if (((a ^ res) & 0x10) !== 0) {
        cpu.f |= flagH;
    }
}

/**
 * @param {Z80} cpu
 * @param {number} y
 * @param {number} val
 * @returns {number}
 */
function rotateCB(cpu, y, val) {
    let c;
    let res;
    switch (y) {
    case 0: // RLC
        c = val >>> 7;
        res = ((val << 1) | c) & 0xFF;
        break;
    case 1: // RRC
        c = val & 1;
        res = ((val >>> 1) | (c << 7)) & 0xFF;
        break;
    case 2: // RL
        c = val >>> 7;
        res = ((val << 1) | (cpu.f & flagC)) & 0xFF;
        break;
    case 3: // RR
        c = val & 1;
        res = ((val >>> 1) | ((cpu.f & flagC) << 7)) & 0xFF;
        break;
    case 4: // SLA
        c = val >>> 7;
        res = (val << 1) & 0xFF;
        break;
    case 5: // SRA
        c = val & 1;
        res = ((val >>> 1) | (val & 0x80)) & 0xFF;
        break;
    case 6: // SLL (undocumented)
        c = val >>> 7;
        res = ((val << 1) | 1) & 0xFF;
        break;
    default: // SRL
        c = val & 1;
        res = (val >>> 1) & 0xFF;
        break;
    }
    cpu.f = sz53p[res] | c;
    return res;
}

/**
 * Approximation: this CPU keeps no MEMPTR/WZ register, so BIT n,(HL) takes the
 * undocumented bits 5/3 from the operand instead of from WZ. The indexed
 * DD/FD CB form is exact, as its caller supplies the address high byte.
 *
 * @param {Z80} cpu
 * @param {number} y
 * @param {number} val
 */
function bitCB(cpu, y, val) {
    const bit = val & (1 << y);
    cpu.f = (cpu.f & flagC) | flagH | (val & (flagX | flagY));
    if (bit === 0) {
        cpu.f |= flagZ | flagP;
    }
    if (y === 7 && bit !== 0) {
        cpu.f |= flagS;
    }
}

// Repeating ED block instructions keep their dense flag and rewind rules together.

/**
 * @param {Z80} cpu
 * @param {Z80Bus} bus
 * @param {number} y
 * @returns {number}
 */
function blockLoad(cpu, bus, y) {
    const hl = (cpu.h << 8) | cpu.l;
    const de = (cpu.d << 8) | cpu.e;
    const bc = (((cpu.b << 8) | cpu.c) - 1) & 0xFFFF;
    const v = bus.read(hl);
    bus.write(de, v);
    let dhl = 1;
    let dde = 1;
    if ((y & 1) !== 0) {
        dhl = -1;
        dde = -1;
    }
    const de2 = (de + dde) & 0xFFFF;
    setHL(cpu, (hl + dhl) & 0xFFFF);
    cpu.d = (de2 >>> 8) & 0xFF;
    cpu.e = de2 & 0xFF;
    cpu.b = (bc >>> 8) & 0xFF;
    cpu.c = bc & 0xFF;
    cpu.f = cpu.f & (flagS | flagZ | flagC);
    const xy = cpu.a + v;
    cpu.f |= xy & flagX;
    if ((xy & 0x02) !== 0) {
        cpu.f |= flagY;
    }
    if (bc !== 0) {
        cpu.f |= flagP;
        if (y >= 6) {
            cpu.pc = (cpu.pc - 2) & 0xFFFF;
            return 21;
        }
    }
    return 16;
}

/**
 * @param {Z80} cpu
 * @param {Z80Bus} bus
 * @param {number} y
 * @returns {number}
 */
function blockCp(cpu, bus, y) {
    const hl = (cpu.h << 8) | cpu.l;
    const v = bus.read(hl);
    const a = cpu.a;
    const res = (a - v) & 0xFF;
    let dhl = 1;
    if ((y & 1) !== 0) {
        dhl = -1;
    }
    setHL(cpu, (hl + dhl) & 0xFFFF);
    const bc = (((cpu.b << 8) | cpu.c) - 1) & 0xFFFF;
    cpu.b = (bc >>> 8) & 0xFF;
    cpu.c = bc & 0xFF;
    cpu.f = (cpu.f & flagC) | flagN | (res & flagS);
    if (res === 0) {
        cpu.f |= flagZ;
    }
    if (((a & 0x0F) - (v & 0x0F)) < 0) {
        cpu.f |= flagH;
    }
    let n = res;
    if ((cpu.f & flagH) !== 0) {
        n -= 1;
    }
    cpu.f |= n & flagX;
    if ((n & 0x02) !== 0) {
        cpu.f |= flagY;
    }
    if (bc !== 0) {
        cpu.f |= flagP;
        if (y >= 6 && res !== 0) {
            cpu.pc = (cpu.pc - 2) & 0xFFFF;
            return 21;
        }
    }
    return 16;
}

/**
 * Execute INI/IND/INIR/INDR or OUTI/OUTD/OTIR/OTDR.
 * Input addresses the port before B changes; output addresses it afterward.
 * Approximation: only the S/Z/5/3/P flags from B are produced. The hardware
 * also derives H, C, and N from the transferred byte plus (C +/- 1); no known
 * software depends on those, so the cheaper form is kept.
 *
 * @param {Z80} cpu
 * @param {Z80Bus} bus
 * @param {number} y
 * @param {boolean} input
 * @param {Z80Clock} clock
 * @returns {number}
 */
function blockIo(cpu, bus, y, input, clock) {
    const hl = (cpu.h << 8) | cpu.l;
    if (input) {
        // M1 4 + ED opcode 5, then the I/O cycle, then the memory write.
        chargeIo(clock, 9);
        const value = bus.ioRead((cpu.b << 8) | cpu.c) & 0xFF;
        bus.write(hl, value);
        cpu.b = (cpu.b - 1) & 0xFF;
    } else {
        // M1 4 + ED opcode 5 + memory read 3, then the I/O cycle.
        const value = bus.read(hl);
        cpu.b = (cpu.b - 1) & 0xFF;
        chargeIo(clock, 12);
        bus.ioWrite((cpu.b << 8) | cpu.c, value);
    }
    let dhl = 1;
    if ((y & 1) !== 0) {
        dhl = -1;
    }
    setHL(cpu, (hl + dhl) & 0xFFFF);
    cpu.f = sz53p[cpu.b];
    if (cpu.b !== 0 && y >= 6) {
        cpu.pc = (cpu.pc - 2) & 0xFFFF;
        return 21;
    }
    return 16;
}

// Condition and register selectors mirror the y/z/p fields used by the maps above.

/**
 * @param {Z80} cpu
 * @param {number} y
 * @returns {boolean}
 */
function cond(cpu, y) {
    switch (y) {
    case 0: // NZ
        return (cpu.f & flagZ) === 0;
    case 1: // Z
        return (cpu.f & flagZ) !== 0;
    case 2: // NC
        return (cpu.f & flagC) === 0;
    case 3: // C
        return (cpu.f & flagC) !== 0;
    case 4: // PO
        return (cpu.f & flagP) === 0;
    case 5: // PE
        return (cpu.f & flagP) !== 0;
    case 6: // P
        return (cpu.f & flagS) === 0;
    default: // M
        return (cpu.f & flagS) !== 0;
    }
}

/**
 * @param {Z80} cpu
 * @param {number} y
 * @param {number} prefix
 * @returns {number}
 */
function getR8(cpu, y, prefix) {
    switch (y) {
    case 0: // B
        return cpu.b;
    case 1: // C
        return cpu.c;
    case 2: // D
        return cpu.d;
    case 3: // E
        return cpu.e;
    case 4: // H, IXH, or IYH
        if (prefix === 0xDD) {
            return cpu.xh;
        }
        if (prefix === 0xFD) {
            return cpu.yh;
        }
        return cpu.h;
    case 5: // L, IXL, or IYL
        if (prefix === 0xDD) {
            return cpu.xl;
        }
        if (prefix === 0xFD) {
            return cpu.yl;
        }
        return cpu.l;
    case 7: // A
        return cpu.a;
    default: // (HL/IX/IY+d) is handled by the caller
        return 0;
    }
}

/**
 * @param {Z80} cpu
 * @param {number} y
 * @param {number} prefix
 * @param {number} val
 */
function setR8(cpu, y, prefix, val) {
    switch (y) {
    case 0: // B
        cpu.b = val;
        break;
    case 1: // C
        cpu.c = val;
        break;
    case 2: // D
        cpu.d = val;
        break;
    case 3: // E
        cpu.e = val;
        break;
    case 4: // H, IXH, or IYH
        if (prefix === 0xDD) {
            cpu.xh = val;
        } else if (prefix === 0xFD) {
            cpu.yh = val;
        } else {
            cpu.h = val;
        }
        break;
    case 5: // L, IXL, or IYL
        if (prefix === 0xDD) {
            cpu.xl = val;
        } else if (prefix === 0xFD) {
            cpu.yl = val;
        } else {
            cpu.l = val;
        }
        break;
    case 7: // A
        cpu.a = val;
        break;
    default: // (HL/IX/IY+d) is handled by the caller
        break;
    }
}

/**
 * @param {Z80} cpu
 * @param {number} prefix
 * @returns {number}
 */
function getXY(cpu, prefix) {
    if (prefix === 0xDD) {
        return (cpu.xh << 8) | cpu.xl;
    }
    if (prefix === 0xFD) {
        return (cpu.yh << 8) | cpu.yl;
    }
    return (cpu.h << 8) | cpu.l;
}

/**
 * @param {Z80} cpu
 * @param {number} prefix
 * @param {number} value
 */
function setXY(cpu, prefix, value) {
    const hi = (value >>> 8) & 0xFF;
    const lo = value & 0xFF;
    if (prefix === 0xDD) {
        cpu.xh = hi;
        cpu.xl = lo;
        return;
    }
    if (prefix === 0xFD) {
        cpu.yh = hi;
        cpu.yl = lo;
        return;
    }
    cpu.h = hi;
    cpu.l = lo;
}

/**
 * @param {Z80} cpu
 * @param {number} p
 * @param {number} prefix
 * @returns {number}
 */
function getRP(cpu, p, prefix) {
    switch (p) {
    case 0: // BC
        return (cpu.b << 8) | cpu.c;
    case 1: // DE
        return (cpu.d << 8) | cpu.e;
    case 2: // HL, IX, or IY
        return getXY(cpu, prefix);
    default: // SP
        return cpu.sp;
    }
}

/**
 * @param {Z80} cpu
 * @param {number} p
 * @param {number} prefix
 * @param {number} value
 */
function setRP(cpu, p, prefix, value) {
    switch (p) {
    case 0: // BC
        cpu.b = (value >>> 8) & 0xFF;
        cpu.c = value & 0xFF;
        break;
    case 1: // DE
        cpu.d = (value >>> 8) & 0xFF;
        cpu.e = value & 0xFF;
        break;
    case 2: // HL, IX, or IY
        setXY(cpu, prefix, value);
        break;
    default: // SP
        cpu.sp = value & 0xFFFF;
        break;
    }
}

/**
 * @param {Z80} cpu
 * @param {number} value
 */
function setHL(cpu, value) {
    cpu.h = (value >>> 8) & 0xFF;
    cpu.l = value & 0xFF;
}

// Little-endian fetch, memory, and stack primitives used by every opcode map.

/**
 * @param {Z80} cpu
 * @param {Z80Bus} bus
 * @returns {number}
 */
function fetch8(cpu, bus) {
    const v = bus.read(cpu.pc);
    cpu.pc = (cpu.pc + 1) & 0xFFFF;
    return v;
}

/**
 * @param {Z80} cpu
 * @param {Z80Bus} bus
 * @returns {number}
 */
function fetch8s(cpu, bus) {
    return (fetch8(cpu, bus) << 24) >> 24;
}

/**
 * @param {Z80} cpu
 * @param {Z80Bus} bus
 * @returns {number}
 */
function fetch16(cpu, bus) {
    const lo = fetch8(cpu, bus);
    const hi = fetch8(cpu, bus);
    return lo | (hi << 8);
}

/**
 * @param {Z80Bus} bus
 * @param {number} addr
 * @returns {number}
 */
function read16(bus, addr) {
    const lo = bus.read(addr);
    const hi = bus.read((addr + 1) & 0xFFFF);
    return lo | (hi << 8);
}

/**
 * @param {Z80Bus} bus
 * @param {number} addr
 * @param {number} value
 */
function write16(bus, addr, value) {
    bus.write(addr, value & 0xFF);
    bus.write((addr + 1) & 0xFFFF, (value >>> 8) & 0xFF);
}

/**
 * @param {Z80} cpu
 * @param {Z80Bus} bus
 * @param {number} value
 */
function push16(cpu, bus, value) {
    cpu.sp = (cpu.sp - 1) & 0xFFFF;
    bus.write(cpu.sp, (value >>> 8) & 0xFF);
    cpu.sp = (cpu.sp - 1) & 0xFFFF;
    bus.write(cpu.sp, value & 0xFF);
}

/**
 * @param {Z80} cpu
 * @param {Z80Bus} bus
 * @returns {number}
 */
function pop16(cpu, bus) {
    const lo = bus.read(cpu.sp);
    cpu.sp = (cpu.sp + 1) & 0xFFFF;
    const hi = bus.read(cpu.sp);
    cpu.sp = (cpu.sp + 1) & 0xFFFF;
    return lo | (hi << 8);
}

/**
 * Charge the M-cycles that run before a bus I/O access, so the machine sees the
 * port at the T-state it really happens instead of at the end of the
 * instruction. runZ80 charges the remainder once the step returns.
 *
 * @param {Z80Clock} clock
 * @param {number} cycles
 */
function chargeIo(clock, cycles) {
    clock.tstates += cycles;
    clock.stepAdded += cycles;
}

/** @param {Z80} cpu */
function bumpR(cpu) {
    cpu.r = (cpu.r & 0x80) | ((cpu.r + 1) & 0x7F);
}
