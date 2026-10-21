#!/bin/sh
set -eu
# This service owns only this bridge and this dedicated INPUT chain.
if ! docker network inspect aiq-prep >/dev/null 2>&1; then
  docker network create --internal --subnet 172.30.223.0/24 --gateway 172.30.223.1 \
    -o com.docker.network.bridge.name=aiqprep0 -o com.docker.network.bridge.enable_icc=false aiq-prep
fi
test "$(docker network inspect -f '{{.Internal}} {{(index .IPAM.Config 0).Subnet}}' aiq-prep)" = 'true 172.30.223.0/24'
iptables -N AIQPREPIN 2>/dev/null || true
iptables -C AIQPREPIN -p tcp -m multiport --dports 3330,3333 -j ACCEPT 2>/dev/null || iptables -A AIQPREPIN -p tcp -m multiport --dports 3330,3333 -j ACCEPT
iptables -C AIQPREPIN -j DROP 2>/dev/null || iptables -A AIQPREPIN -j DROP
iptables -C INPUT -i aiqprep0 -j AIQPREPIN 2>/dev/null || iptables -I INPUT 1 -i aiqprep0 -j AIQPREPIN
