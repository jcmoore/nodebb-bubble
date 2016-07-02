# Dockerfile extending the generic Node image with application files for a
# single application.
FROM gcr.io/google_appengine/nodejs
COPY ./packagejson/nodebb/package.json /app/packagejson/nodebb/package.json
RUN (cd packagejson/nodebb && npm run prep)
# You have to specify "--unsafe-perm" with npm install
# when running as root.  Failing to do this can cause
# install to appear to succeed even if a preinstall
# script fails, and may have other adverse consequences
# as well.
# This command will also cat the npm-debug.log file after the
# build, if it exists.
COPY ./package.json /app/package.json
RUN npm install --unsafe-perm || \
  ((if [ -f npm-debug.log ]; then \
      cat npm-debug.log; \
    fi) && false)
COPY . /app/
COPY ./package.json /app/package.json.main
CMD npm run nodebb
