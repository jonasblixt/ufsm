cat <<EOF > tmp_dockerfile
FROM sphinxdoc/sphinx
RUN apt-get update -y
RUN apt-get install -y doxygen
COPY docs/requirements.txt /requirements.txt
RUN pip3 install -r /requirements.txt
EOF

docker build -f tmp_dockerfile -t local_sphinx_docker $(pwd)/$(dirname $0)/..
rm tmp_dockerfile
docker run --rm -u $(id -u):$(id -g) -v $(pwd)/$(dirname $0)/..:/docs local_sphinx_docker bash -c "cd doc && doxygen doxygen.cfg && sphinx-build -b html . _build/html"
