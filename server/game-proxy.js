function patchGameAsset(text) {
  return text
    .replace(
      /function\s+([A-Za-z_$][\w$]*)\(\)\{const\s+([A-Za-z_$][\w$]*)=Ps\(\);return\s+\2==="xx\.liulabinfo\.org"\?"xxapi\.liulabinfo\.org":\2\|\|"127\.0\.0\.1"\}/g,
      'function $1(){return"xxapi.liulabinfo.org"}',
    )
    .replace(
      /function\s+([A-Za-z_$][\w$]*)\(\)\{return\s+[A-Za-z_$][\w$]*\(Ps\(\)\)\?"443":"7350"\}/g,
      'function $1(){return"443"}',
    )
    .replace(
      /function\s+([A-Za-z_$][\w$]*)\(\)\{return\s+[A-Za-z_$][\w$]*\(Ps\(\)\)\}/g,
      'function $1(){return true}',
    )
    .replace(
      /new\s+([A-Za-z_$][\w$]*)\("supersecret_dev_key",[A-Za-z_$][\w$]*\(\),[A-Za-z_$][\w$]*\(\),[A-Za-z_$][\w$]*\)/g,
      'new $1("supersecret_dev_key","xxapi.liulabinfo.org","443",true)',
    );
}

function gameBootstrapPage(recoveryId) {
  const encodedRecoveryId = JSON.stringify(String(recoveryId || ''));
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>修仙 WebView</title>
  </head>
  <body>
    <script>
      const recoveryId = ${encodedRecoveryId};
      if (recoveryId) {
        localStorage.setItem('xiuxian.device.id', recoveryId);
        localStorage.removeItem('xiuxian.session.token');
        localStorage.removeItem('xiuxian.session.refresh');
      }
      location.replace('/game-proxy/');
    </script>
  </body>
</html>`;
}

function createGameProxy(options = {}) {
  const origin = options.origin || 'https://xx.liulabinfo.org';

  async function proxyAsset(req, res, next) {
    try {
      const assetPath = req.params[0] || '';
      const upstream = new URL(`/assets/${assetPath}`, origin);
      const response = await fetch(upstream);
      const type = response.headers.get('content-type') || 'application/octet-stream';
      const buffer = Buffer.from(await response.arrayBuffer());

      res.set('Cache-Control', 'no-store');
      res.type(type);
      if (type.includes('javascript')) {
        res.send(patchGameAsset(buffer.toString('utf8')));
      } else {
        res.send(buffer);
      }
    } catch (error) {
      next(error);
    }
  }

  async function proxyPage(req, res, next) {
    try {
      const upstream = new URL('/', origin);
      const response = await fetch(upstream);
      let html = await response.text();
      html = html
        .replace(/(src|href)=["']\/assets\//g, '$1="/game-assets/')
        .replace(/<base[^>]*>/gi, '');
      res.set('Cache-Control', 'no-store');
      res.type('html').send(html);
    } catch (error) {
      next(error);
    }
  }

  return {
    proxyAsset,
    proxyPage,
    gameBootstrapPage,
  };
}

module.exports = {
  createGameProxy,
  gameBootstrapPage,
  patchGameAsset,
};
