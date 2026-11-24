#!/usr/bin/env python3
"""Extract the Supabase pooler's full TLS chain (server-sent) as one PEM file."""
import socket
import ssl

HOST = "aws-0-ap-south-1.pooler.supabase.com"
PORT = 5432

s = socket.create_connection((HOST, PORT), timeout=15)
s.sendall(b"\x00\x00\x00\x08\x04\xd2\x16\x2f")  # SSLRequest
resp = s.recv(1)
assert resp == b"S", f"server refused TLS: {resp!r}"

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
tls = ctx.wrap_socket(s, server_hostname=HOST)

der_chain = tls.get_verified_chain() if hasattr(tls, "get_verified_chain") else tls.getpeercert(binary_form=True)
# getpeercert(binary) gives only the leaf; try the newer API, else parse from
# the TLS handshake ourselves via the socket's internal state.
pems = []
if isinstance(der_chain, list):
    for der in der_chain:
        pems.append(ssl.DER_cert_to_PEM_cert(der))
else:
    pems.append(ssl.DER_cert_to_PEM_cert(der_chain))

# Also fetch the missing root: the pooler chain is signed by Amazon Trust Services.
# If the last cert in the chain is not self-signed, download the matching root
# from the Amazon Trust Repository (public, well-known URLs).
import urllib.request, re, base64
leaf_issuer = None
if pems:
    import subprocess
    r = subprocess.run(["openssl", "x509", "-in", "/dev/stdin", "-noout", "-issuer"],
                       input=pems[-1], capture_output=True, text=True)
    leaf_issuer = r.stdout.strip()
print("chain certs:", len(pems))
for p in pems:
    r = subprocess.run(["openssl", "x509", "-in", "/dev/stdin", "-noout", "-subject", "-issuer"],
                       input=p, capture_output=True, text=True)
    print(r.stdout.strip())
open("/tmp/pooler_chain.pem", "w").write("\n".join(pems))
print("saved /tmp/pooler_chain.pem")
