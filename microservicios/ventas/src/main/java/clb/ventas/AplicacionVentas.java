package clb.ventas;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class AplicacionVentas {
    public static void main(String[] argumentos) {
        SpringApplication.run(AplicacionVentas.class, argumentos);
    }
}
