import asyncio
import struct

from modbus_source import ModbusSource, decode


def float_regs(value):
    hi, lo = struct.unpack(">HH", struct.pack(">f", value))
    return [hi, lo]


def test_decode_types():
    assert decode([0xFFFF], "int16") == -1
    assert decode([0xFFFF], "uint16") == 65535
    assert abs(decode(float_regs(480.5), "float32") - 480.5) < 1e-4
    assert abs(decode(list(reversed(float_regs(59.98))), "float32", "little") - 59.98) < 1e-4
    assert decode([0x0001, 0x0000], "uint32") == 65536
    assert decode([1], "bool") is True


class FakeResult:
    def __init__(self, registers=None, bits=None, error=False):
        self.registers, self.bits, self._error = registers, bits, error

    def isError(self):
        return self._error


class FakeClient:
    def __init__(self, fail=False):
        self.connected = False
        self.fail = fail

    async def connect(self):
        self.connected = True

    async def read_holding_registers(self, address, count, slave):
        if self.fail:
            return FakeResult(error=True)
        return FakeResult(registers={3000: float_regs(481.0), 3002: float_regs(800.0)}[address])

    async def read_discrete_inputs(self, address, count, slave):
        return FakeResult(bits=[True])

    def close(self):
        pass


def make_source(fail=False):
    cfg = {"devices": [{
        "meter_id": "UTIL-1", "host": "meter.example.internal", "unit_id": 1,
        "registers": {
            "voltage": {"address": 3000, "type": "float32"},
            "current": {"address": 3002, "type": "float32"},
        },
    }]}
    return ModbusSource(cfg, client_factory=lambda host, port, timeout: FakeClient(fail))


def test_modbus_reading_shape():
    out = asyncio.run(make_source().read_all(1_760_000_000.0))
    r = out["UTIL-1"]
    assert r["voltage"] == 481.0 and r["current"] == 800.0
    assert r["load_pct"] == 50.0  # 800 A on a 1600 A service
    assert r["comm_ok"] is True and r["status"] == "Online"


def test_modbus_comm_failure_is_reported():
    r = asyncio.run(make_source(fail=True).read_all(1_760_000_000.0))["UTIL-1"]
    assert r["comm_ok"] is False and r["status"] == "Comm Fail"
    assert r["voltage"] is None
