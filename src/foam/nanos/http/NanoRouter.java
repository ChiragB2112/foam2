package foam.nanos.http;

import foam.box.Skeleton;
import foam.core.ContextAware;
import foam.core.X;
import foam.dao.DAO;
import foam.dao.DAOSkeleton;
import foam.nanos.NanoService;
import foam.nanos.boot.NSpec;
import foam.nanos.logger.NanoLogger;
import foam.nanos.pm.PM;

import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Created by nick on 17/07/17.
 */
public class NanoRouter
  extends HttpServlet
  implements NanoService, ContextAware
{
  protected X x_;

  protected Map<String, HttpServlet> handlerMap_ = new ConcurrentHashMap<>();

  @Override
  protected void service(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
    String      path       = req.getRequestURI();
    //AuthService auth       = this.X.get("authService");
    String[]    urlParams  = path.split("/");
    String      serviceKey = urlParams[1];
    Object      service    = getX().get(serviceKey);
    DAO         nSpecDAO   = (DAO) getX().get("nSpecDAO");
    NSpec       spec       = (NSpec) nSpecDAO.find(serviceKey);

    HttpServlet serv = getServlet(spec, service);
    PM pm = new PM(this.getClass(), serviceKey);
    try {
      serv.service(req, resp);
    } finally {
      pm.log(x_);
    }
  }

  private HttpServlet getServlet(NSpec spec, Object service) {
    if ( spec == null ) return null;

    if ( ! handlerMap_.containsKey(spec.getName()) ) {
      handlerMap_.put(spec.getName(), createServlet(spec, service));
    }

    return handlerMap_.get(spec.getName());
  }

  private HttpServlet createServlet(NSpec spec, Object service) {
    if ( spec.getServe() ) {
      try {
        Class cls = spec.getBoxClass() != null && spec.getBoxClass().length() > 0 ?
            Class.forName(spec.getBoxClass()) :
            DAOSkeleton.class ;
        Skeleton skeleton = (Skeleton) cls.newInstance();

        if ( skeleton instanceof ContextAware) ((ContextAware) skeleton).setX(getX());

        skeleton.setDelegateObject(service);

        service = new ServiceServlet(service, skeleton);
      } catch (IllegalAccessException | InstantiationException | ClassNotFoundException ignored) {
      }
    }

    if ( service instanceof WebAgent ) service = new WebAgentServlet((WebAgent) service);

    if ( service instanceof ContextAware ) ((ContextAware ) service).setX(getX());

    if( service instanceof HttpServlet ) return (HttpServlet) service;
    else {
      NanoLogger logger = (NanoLogger) getX().get("logger");
      logger.error(this.getClass(), spec.getName() + " does not have a HttpServlet.");
      return null;
    }
  }

  @Override
  public void start() {

  }

  @Override
  public X getX() {
    return x_;
  }

  @Override
  public void setX(X x) {
    x_ = x;
  }
}